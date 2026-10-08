import {assertApproved} from "../server/release-policy.mjs";
import {assertProjectServing} from './memberships.mjs';
import {demand, sha, id} from '../server/core.mjs';

const projectId = /^p-[a-f0-9]{12}$/;
const releaseId = /^d-[a-f0-9]{12}$/;
const key = rid => 'published/'+rid+'/';
export const responseContentType=type=>/^(text\/|application\/(javascript|json)|image\/svg\+xml)/i.test(type)&&!type.includes('charset=')?type+'; charset=utf-8':type;
export function siteHost(host, domain) {
  if (!domain || !host.endsWith('.'+domain)) return null;
  const name=host.slice(0,-domain.length-1);
  return projectId.test(name)?{project:name}:releaseId.test(name)?{release:name}:null;
}
export function sitePath(pathname, files) {
  let path;
  try { path=decodeURIComponent(pathname).replace(/^\//,''); } catch { return null; }
  if (path.includes('\\') || /[\x00-\x1f\x7f]/.test(path) || path.split('/').some(p=>p==='..'||p.startsWith('.'))) return null;
  const names=new Set(files.map(f=>f.path));
  for(const p of [path,path+'index.html',path+'.html',path.replace(/\/$/,'')+'/index.html']) if(names.has(p)) return p;
  // Only extensionless application routes receive the SPA shell. Missing assets stay 404.
  return !path.split('/').pop().includes('.') && names.has('index.html')?'index.html':null;
}
export async function publishSite(env,store,user,release,{beforePublic=async()=>{},afterPublic=()=>{}}={}) {
  demand(env.SITE_DOMAIN && env.PUBLICATIONS,'版本入口尚未配置',409);
  const dnsHosts=new Set((env.SITE_DNS_HOSTS||'').split(',').map(h=>h.trim()));
  demand(env.SITE_DNS_READY==='true' || (dnsHosts.has(release.projectId) && dnsHosts.has(release.id)),'版本网址尚未完成域名配置，暂时无法发布访问入口',409);
  assertApproved(store,release);
  store.validateRelease(release);
  await beforePublic(release,'site');
  const prefix=key(release.id), existing=await env.ARTIFACTS.get(prefix+'manifest.json');
  if(existing) {
    const old=await existing.json();
    demand(old.owner===user.id && old.manifestHash===release.manifestHash && old.projectId===release.projectId,'固定版本不可改写',409);
  } else {
    for(let offset=0;offset<release.files.length;offset+=8)await Promise.all(release.files.slice(offset,offset+8).map(async f=>{
      const bytes=Buffer.from(f.base64,'base64');demand(sha(bytes)===f.sha256,'文件完整性检查失败',409);
      await env.ARTIFACTS.put(prefix+'files/'+f.path,bytes,{httpMetadata:{contentType:f.contentType},customMetadata:{owner:user.id,releaseId:release.id}});
    }));
    await env.ARTIFACTS.put(prefix+'manifest.json',JSON.stringify({owner:user.id,projectId:release.projectId,releaseId:release.id,manifestHash:release.manifestHash,files:release.files.map(({base64,...f})=>f)}),{customMetadata:{owner:user.id,releaseId:release.id}});
  }
  const object=env.PUBLICATIONS.get(env.PUBLICATIONS.idFromName(release.projectId));
  const result=await object.fetch('https://internal/publish',{method:'POST',body:JSON.stringify({owner:user.id,projectId:release.projectId,releaseId:release.id,manifestHash:release.manifestHash})});
  demand(result.ok,'版本入口暂时无法切换',503);
  const publication={status:'pending-access-check',url:'https://'+release.id+'.'+env.SITE_DOMAIN,stableUrl:'https://'+release.projectId+'.'+env.SITE_DOMAIN,manifestHash:release.manifestHash,at:new Date().toISOString()};
  release.site=publication;store.project(release.projectId).siteProductionId=release.id;startSiteCheck(store,release);store.save();
  store.log(release.projectId,'版本入口已切换；固定网址隔离页面、资源和 Service Worker','success',release.id);
  afterPublic(release,'site');
  return publication;
}
export function startSiteCheck(store,release) {
  assertApproved(store,release);
  demand(release.site&&store.project(release.projectId).siteProductionId===release.id,'此版本已不是当前访问入口',409);
  release.site.checkId=id('access');release.site.checkStartedAt=Date.now();release.site.status='pending-access-check';
  store.save();return release.site;
}
export function confirmSiteAccess(store,release,input) {
  assertApproved(store,release);
  const site=release.site;
  demand(site&&store.project(release.projectId).siteProductionId===release.id&&input.checkId===site.checkId&&site.checkId&&Date.now()-site.checkStartedAt<300000,'访问核验已过期或入口已切换，请重新检查',409);
  demand(Array.isArray(input.failedPaths)&&input.failedPaths.length<=release.files.length&&input.failedPaths.every(p=>release.files.some(f=>f.path===p)),'访问核验结果无效');
  delete site.checkId;
  site.accessCheck={at:new Date().toISOString(),failedPaths:input.failedPaths,stableEntry:input.stableEntry===true,scope:'current-browser'};
  if(input.failedPaths.length||input.stableEntry!==true){site.status='pending-access-check';store.save();demand(false,'入口已设置，但当前节点访问尚未通过；重试核验不会重新上传或付 gas',409);}
  site.status='published';release.receipt=store.receiptFor(release,'cloud-file-verification');store.save();store.log(release.projectId,'稳定入口与全部版本文件已在当前浏览器逐字节核验','success',release.id);return site;
}
export async function serveSite(request,env,ctx) {
  const url=new URL(request.url), host=siteHost(url.hostname,env.SITE_DOMAIN);
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*','Referrer-Policy':'no-referrer'};
  if(!host || !['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404,headers});
  if(env.SITES_DISABLED==='true')return new Response('Temporarily unavailable',{status:503,headers});
  if(host.project) {
    const object=env.PUBLICATIONS.get(env.PUBLICATIONS.idFromName(host.project));
    const res=await object.fetch('https://internal/current');
    if(!res.ok)return new Response('Not published',{status:404,headers});
    const current=await res.json();
    await assertProjectServing(env,current.owner,current.projectId);
    return new Response(null,{status:307,headers:{...headers,Location:'https://'+current.releaseId+'.'+env.SITE_DOMAIN+url.pathname+url.search}});
  }
  // A release gets its own origin. Never serve uploaded HTML on the control-plane origin.
  const cacheKey=new Request(url.origin+url.pathname,{method:'GET'});
  const cache=globalThis.caches?.default;
    const object=await env.ARTIFACTS.get(key(host.release)+'manifest.json');
  if(!object)return new Response('Not published',{status:404,headers});
  const manifest=await object.json();headers['X-TapeNow-Project']=manifest.projectId;
  await assertProjectServing(env,manifest.owner,manifest.projectId);
  const hit=cache?await cache.match(cacheKey):null;
  if(hit&&hit.headers.get('X-TapeNow-Project'))return request.method==='HEAD'?new Response(null,hit):hit;
  const path=sitePath(url.pathname,manifest.files);
  if(!path)return new Response('Not found',{status:404,headers});
  const file=manifest.files.find(f=>f.path===path), content=await env.ARTIFACTS.get(key(host.release)+'files/'+path);
  if(!content)return new Response('Artifact unavailable',{status:503,headers});
  const response=new Response(content.body,{headers:{...headers,'Cache-Control':'public, max-age=31536000, immutable','Content-Type':responseContentType(file.contentType),'ETag':'"'+file.sha256+'"','X-TapeNow-Bytes':String(file.bytes),'X-TapeNow-Release':host.release,'X-TapeNow-Manifest':manifest.manifestHash}});
  if(cache)ctx.waitUntil(cache.put(cacheKey,response.clone()));
  return request.method==='HEAD'?new Response(null,response):response;
}
