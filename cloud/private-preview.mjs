import {LOCKUP_SVG} from './brand-assets.mjs';
import {assertProjectServing} from './memberships.mjs';
import {betaCapabilities,BETA_LIMITS} from '../server/beta-policy.mjs';
import {randomBytes} from 'node:crypto';
import {demand,sha} from '../server/core.mjs';
import {sitePath,responseContentType} from './sites.mjs';
import {nonce,seal,unseal,equal,readLimitedJson,readLimitedText,assertOrigin,fingerprint} from './security.mjs';
const prefix=rid=>'private/'+rid+'/';
export function privateHost(host,domain) {
  if(!domain||!host.endsWith('.'+domain))return null;
  const name=host.slice(0,-domain.length-1);return /^v-d-[a-f0-9]{12}$/.test(name)?name.slice(2):null;
}
export async function passwordHash(password,salt) {
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return Buffer.from(await crypto.subtle.deriveBits({name:'PBKDF2',salt:Buffer.from(salt,'hex'),iterations:100000,hash:'SHA-256'},material,256)).toString('hex');
}
export function publiclyExposed(r){return !!(r.publicExposure||r.preview?.url||r.site?.url||r.cloudflare?.url||r.cloudflareProduction?.url||r.chainStatus==='verified'||r.transactions?.length);}
export async function createPrivatePreview(env,store,user,r,input,commit=async()=>{}) {
  demand(env.SITE_DOMAIN&&env.SITE_DNS_READY==='true','私有预览域名尚未配置',409);
  demand(!publiclyExposed(r),'此版本已经发往公开入口，无法改为保密；请导入一个新的未公开版本',409);
  demand((r.archive?.state||'available')==='available','请先从回收站恢复归档',409);store.validateRelease(r);
  const beta=betaCapabilities(env,user,store).phase==='A';
  const hours=Number(input.hours||24),maxHours=beta?BETA_LIMITS.previewHours:168;
  demand(Number.isInteger(hours)&&hours>=1&&hours<=maxHours,beta?'A 公测每次私有预览最长 24 小时':'有效期需要为 1–168 小时');
  store.state.previewLifetimes||={};
  const firstCreatedAt=store.state.previewLifetimes[r.manifestHash]||r.privatePreview?.firstCreatedAt||new Date().toISOString();
  if(beta)demand(Date.now()+hours*3600000<=Date.parse(firstCreatedAt)+BETA_LIMITS.previewLifetimeHours*3600000,'此版本的预览生命周期已用完，请导出或正式发布到外部入口',429);
  if(beta)store.state.previewLifetimes[r.manifestHash]=firstCreatedAt;
  const password=input.password||randomBytes(18).toString('base64url');
  demand(typeof password==='string'&&password.length>=12&&password.length<=128,'密码需要为 12–128 个字符');
  const salt=randomBytes(16).toString('hex'),revision=nonce(),expiresAt=new Date(Date.now()+hours*3600000).toISOString();
  const old=await env.ARTIFACTS.get(prefix(r.id)+'manifest.json');
  if(old){const meta=await old.json();demand(meta.owner===user.id&&meta.manifestHash===r.manifestHash,'预览归属检查失败',409);}
  demand(!await env.ARTIFACTS.get('published/'+r.id+'/manifest.json'),'此版本已有公开文件，无法改为保密；请导入新的版本',409);
  r.privatePreview={status:'preparing',url:'https://v-'+r.id+'.'+env.SITE_DOMAIN,expiresAt,firstCreatedAt,at:new Date().toISOString(),...(beta?{quota:BETA_LIMITS}:{})};
  store.save();await commit();
  for(let i=0;i<r.files.length;i+=8)await Promise.all(r.files.slice(i,i+8).map(f=>env.ARTIFACTS.put(prefix(r.id)+'files/'+f.path,Buffer.from(f.base64,'base64'),{httpMetadata:{contentType:f.contentType},customMetadata:{owner:user.id,releaseId:r.id}})));
  await env.ARTIFACTS.put(prefix(r.id)+'manifest.json',JSON.stringify({owner:user.id,releaseId:r.id,projectId:r.projectId,manifestHash:r.manifestHash,status:'active',salt,passwordHash:await passwordHash(password,salt),revision,expiresAt,betaQuota:beta,files:r.files.map(({base64,...f})=>f)}),{customMetadata:{owner:user.id,releaseId:r.id}});
  r.privatePreview.status='active';store.save();store.log(r.projectId,'已创建密码预览；密码不会出现在项目记录中','success',r.id);
  return {...r.privatePreview,password};
}
export async function revokePrivatePreview(env,store,user,r) {
  const object=await env.ARTIFACTS.get(prefix(r.id)+'manifest.json');
  demand(object||r.privatePreview?.status==='preparing','私有预览不存在',404);
  if(object){const m=await object.json();
  await assertProjectServing(env,m.owner,m.projectId);
    demand(m.owner===user.id&&m.manifestHash===r.manifestHash,'预览归属检查失败',403);m.status='revoked';m.revision=nonce();
    await env.ARTIFACTS.put(prefix(r.id)+'manifest.json',JSON.stringify(m),{customMetadata:{owner:user.id,releaseId:r.id}});
  }
  r.privatePreview={...r.privatePreview,status:'revoked'};store.save();store.log(r.projectId,'私有预览已撤销；现有浏览器会话的后续请求也将拒绝','info',r.id);return {revoked:true};
}
const headers={'Cache-Control':'no-store, max-age=0','CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"worker-src 'none'; frame-ancestors 'none'"};
const previewLanguage=request=>new URL(request.url).searchParams.get('lang')==='zh-CN'?'zh-CN':'en';
const lockPage=language=>{
  const en=language==='en';
  return `<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TapeNow · ${en?'Private preview':'私有预览'}</title><style>body{font:16px system-ui;color:#142c2d;background:#f5f5ee;margin:0;min-height:100vh;display:grid;place-items:center}main{box-sizing:border-box;width:calc(100% - 40px);max-width:400px;padding:28px;background:white;border:1px solid #cbd5cf;border-radius:16px;margin:20px}.preview-brand svg{display:block;width:176px;max-width:100%;height:auto}h1{font-size:28px;line-height:1.3}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #087f76;outline-offset:3px}input,button{font:inherit;box-sizing:border-box;width:100%;padding:12px;border-radius:6px;margin:12px 0;border:1px solid #cbd5cf}button{background:#087f76;color:white;border-color:#087f76;cursor:pointer}p{color:#526666;line-height:1.7}nav{font-size:14px;margin-bottom:18px}a{color:inherit}</style><main><nav aria-label="${en?'Language':'语言'}"><a href="?lang=zh-CN" lang="zh-CN">简体中文</a> · <a href="?lang=en" lang="en">English</a></nav><div class="preview-brand">${LOCKUP_SVG}</div><h1>${en?'Private preview':'私有预览'}</h1><p>${en?'The publisher protected this release with a password. Access stops when authorization expires or is revoked.':'发布者为这个版本设置了密码。授权到期或撤销后，后续访问将停止。'}</p><form method="post" action="/__tapenow/unlock?lang=${language}"><label for="password">${en?'Preview password':'预览密码'}</label><input id="password" name="password" type="password" required minlength="12" maxlength="128" autocomplete="current-password"><button>${en?'Open preview':'打开预览'}</button></form></main></html>`;
};
export async function servePrivate(request,env,rid,{time=Date.now()}={}) {
  let projectId='';const language=previewLanguage(request),copy=(zh,en)=>language==='en'?en:zh;
  const respond=(body,status=200,extra={})=>new Response(body,{status,headers:{...headers,...(projectId?{'X-TapeNow-Project':projectId}:{}),...extra}});
  const object=await env.ARTIFACTS.get(prefix(rid)+'manifest.json');if(!object)return respond(copy('预览不存在','Preview not found'),404);
  const m=await object.json(),url=new URL(request.url);projectId=m.projectId;
  await assertProjectServing(env,m.owner,m.projectId);
  if(m.status!=='active'||Date.parse(m.expiresAt)<=time)return respond(copy('此预览已过期或撤销，请联系发布者。','This preview expired or was revoked. Contact the publisher.'),410,{'Content-Type':'text/plain; charset=utf-8'});
  if(m.betaQuota){
    if(!env.METRICS)return respond(copy('预览额度暂不可用','Preview quota unavailable'),503);
    const file=m.files.find(f=>f.path===sitePath(url.pathname,m.files));
    const quota=await env.METRICS.get(env.METRICS.idFromName('preview:'+m.owner)).fetch('https://metrics/preview-reserve',{method:'POST',body:JSON.stringify({bytes:request.method==='GET'?file?.bytes||0:0})});
    if(!quota.ok)return respond(copy('本月私有预览额度已用完，请使用正式发布网址。','Monthly private preview allowance reached. Use the published website.'),quota.status===429?429:503);
  }
  if(url.pathname==='/__tapenow/unlock'&&request.method==='POST') {
    assertOrigin(request,url.origin);
    if(env.RATE){const limit=await env.RATE.get(env.RATE.idFromName('preview:'+rid+':'+fingerprint(request.headers.get('CF-Connecting-IP')||'local'))).fetch('https://rate/');if(!limit.ok)return respond(copy('尝试过于频繁，请一分钟后再试。','Too many attempts. Retry in one minute.'),429,{'Retry-After':'60'});}
    let input;
    if(request.headers.get('content-type')?.includes('application/json'))input=await readLimitedJson(request,2048);
    else input=Object.fromEntries(new URLSearchParams(await readLimitedText(request,2048)));
    const pass=String(input.password||'');
    if(pass.length<12||pass.length>128||!equal(await passwordHash(pass,m.salt),m.passwordHash))return respond(copy('密码不正确，请返回重试。','Incorrect password. Go back and retry.'),403,{'Content-Type':'text/plain; charset=utf-8'});
    const expiry=Math.min(Date.parse(m.expiresAt),time+86400000),cookie=seal({rid,revision:m.revision,expires:expiry},env.VAULT_KEY,'private-preview');
    return respond(null,303,{'Location':'/','Set-Cookie':`__Host-tapenow-preview=${cookie}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.floor((expiry-time)/1000)}`});
  }
  if(!['GET','HEAD'].includes(request.method))return respond(copy('未找到','Not found'),404);
  const box=request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-tapenow-preview=([\w-]+)(?:;|$)/)?.[1];let session;
  try{if(box&&box.length<2048)session=unseal(box,env.VAULT_KEY,'private-preview');}catch{}
  if(!session||session.rid!==rid||session.revision!==m.revision||session.expires<=time)
    return respond(request.method==='HEAD'?null:lockPage(language),401,{'Content-Type':'text/html; charset=utf-8'});
  const path=sitePath(url.pathname,m.files),f=m.files.find(f=>f.path===path);if(!f)return respond(copy('未找到','Not found'),404);
  const data=await env.ARTIFACTS.get(prefix(rid)+'files/'+path);if(!data)return respond(copy('预览暂不可用','Preview temporarily unavailable'),503);
  return respond(request.method==='HEAD'?null:data.body,200,{'Content-Type':responseContentType(f.contentType),'X-TapeNow-Manifest':m.manifestHash,'X-TapeNow-Project':m.projectId,'X-TapeNow-Bytes':String(f.bytes)});
}
