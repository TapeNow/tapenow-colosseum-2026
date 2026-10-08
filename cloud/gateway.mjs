import {demand,sha} from '../server/core.mjs';
import {readVerifiedArtifact} from '../server/chain-observer.mjs';
import {gatewaySnapshot,verifyGatewayChallenge,assertGatewayOwner,readGatewayIdentity,gatewayVersionHost,gatewayProjectHost,gatewayPath,GATEWAY_LEASE_MS} from '../server/gateway.mjs';
import {assertProjectServing} from './memberships.mjs';
import {responseContentType} from './sites.mjs';
import {digest,assertApproved} from '../server/release-policy.mjs';

export const gatewayEnabled=env=>env.GATEWAY_ENABLED==='true'&&!!env.GATEWAY_ROOT&&!!env.PUBLICATIONS&&!!env.ARTIFACTS;
const prefix=version=>'gateway/versions/'+version+'/';
const binding= (env,host)=>env.PUBLICATIONS.get(env.PUBLICATIONS.idFromName('gateway:host:'+host));
export async function gatewayBinding(env,host){const r=await binding(env,host).fetch('https://internal/');return r.ok?await r.json():null;}
export async function writeGatewayBinding(env,host,value,previous){
  if(previous===undefined)previous=await gatewayBinding(env,host);
  const r=await binding(env,host).fetch('https://internal/',{method:'POST',body:JSON.stringify({gatewayBinding:{value,hostname:host,expectedRevision:previous?.revision??null}})});
  demand(r.ok,'域名已属于其他项目或入口已变化，请重试',r.status===409?409:503);return r.json();
}
export async function deleteGatewayBinding(env,host,owner,projectId){
  const current=await gatewayBinding(env,host);if(!current)return;
  demand(current.owner===owner&&current.projectId===projectId,'域名归属不匹配',403);
  if(current.gateway.status==='deleted')return;
  await writeGatewayBinding(env,host,{...current,gateway:{...current.gateway,status:'deleted',leaseUntil:0}},current);
}
export async function publishGateway(env,store,user,release,input,{beforePublic,afterPublic,readArtifact=readVerifiedArtifact,identity=readGatewayIdentity,restore=false,actorId=user.id}={}) {
  demand(gatewayEnabled(env),'TapeNow Gateway 尚未配置',409);
  const q=verifyGatewayChallenge(store,release,input,user.id,Date.now(),actorId),project=store.project(release.projectId);
  let report;
  if(restore){
    demand(release.gateway&&release.gateway.status!=='retired','旧网关缓存已停用，无法直接恢复',409);
    const obj=await env.ARTIFACTS.get(prefix(release.gateway.versionId)+'manifest.json');demand(obj,'旧网关缓存不存在',409);const saved=await obj.json();
    demand(saved.owner===user.id&&saved.releaseId===release.id&&digest(q.target)===digest({chainId:saved.target.chainId,cpuIndex:saved.target.cpuIndex,tokenId:saved.target.tokenId}),'恢复版本与发布目标不匹配',409);
    const restored=[];for(const f of saved.files){const data=await env.ARTIFACTS.get(prefix(saved.versionId)+'files/'+f.path);demand(data,'旧版本文件缺失',409);restored.push({...f,base64:Buffer.from(await data.arrayBuffer()).toString('base64')});}
    report={...saved,...saved.target,files:restored,status:'verified',live:true,bytes:restored.reduce((n,f)=>n+f.bytes,0),paidUntil:new Date(Date.now()+60000).toISOString()};
  }else report=await readArtifact(q.target);
  let snapshot=gatewaySnapshot(report,q.target,release);
  if(release.gateway?.status!=='retired'&&release.gateway?.manifestHash===release.manifestHash&&digest(release.gateway.target)===digest(snapshot.target)){
    const object=await env.ARTIFACTS.get(prefix(release.gateway.versionId)+'manifest.json');
    if(object){const old=await object.json();if(old.owner===user.id&&old.releaseId===release.id&&digest(old.files)===digest(snapshot.files)&&old.fallback===snapshot.fallback)snapshot=old;}
  }
  const history=project.gatewayVersions||[];
  demand(history.includes(snapshot.versionId)||history.length<20,'已达到 20 个网关版本，请先停用不再需要的旧版本',409);
  const holder=await identity(q.target);assertGatewayOwner(holder,q);
  demand(holder.container.toLowerCase()===snapshot.target.container.toLowerCase(),'核验期间容器发生变化',409);
  verifyGatewayChallenge(store,release,input,user.id,Date.now(),actorId);
  await beforePublic(release,'gateway');
  const base=prefix(snapshot.versionId),old=await env.ARTIFACTS.get(base+'manifest.json');
  if(old){const m=await old.json();demand(m.owner===user.id&&m.manifestHash===snapshot.manifestHash,'固定版本归属不一致',409);}
  else {
    for(const f of report.files)await env.ARTIFACTS.put(base+'files/'+f.path,Buffer.from(f.base64,'base64'),{customMetadata:{owner:user.id,releaseId:release.id},httpMetadata:{contentType:f.contentType}});
    await env.ARTIFACTS.put(base+'manifest.json',JSON.stringify({...snapshot,owner:user.id}),{customMetadata:{owner:user.id,releaseId:release.id}});
  }
  const versionHost=gatewayVersionHost(snapshot.versionId,env.GATEWAY_ROOT),stableHost=gatewayProjectHost(project.id,env.GATEWAY_ROOT);
  const live={status:'active',versionId:snapshot.versionId,versionHost,target:snapshot.target,chainOwner:holder.owner,leaseUntil:Date.now()+GATEWAY_LEASE_MS,paidUntil:holder.paidUntil,checkedAt:holder.checkedAt,contentCheckedAt:snapshot.checkedAt};
  const record={owner:user.id,projectId:project.id,releaseId:release.id,manifestHash:release.manifestHash,gateway:live};
  // Content and its immutable manifest exist before either public pointer moves.
  await writeGatewayBinding(env,versionHost,record);
  await writeGatewayBinding(env,stableHost,{...record,gateway:{...live,alias:true}});
  const result={...live,stableUrl:'https://'+stableHost,versionUrl:'https://'+versionHost,manifestUrl:'https://'+versionHost+'/__tapenow/manifest.json',blockNumber:snapshot.blockNumber,blockHash:snapshot.blockHash,manifestHash:snapshot.manifestHash,nativeUrl:snapshot.nativeUrl,mode:'pinned',files:snapshot.files,bytes:report.bytes};
  if(restore)result.restoredAt=new Date().toISOString();
  release.gateway=result;project.gateway={...result,releaseId:release.id};project.gatewayVersions=[...new Set([...history,snapshot.versionId])];q.used=true;store.save();afterPublic(release,'gateway');
  store.log(project.id,'Gateway 已发布已核验的固定版本；稳定入口跳转到独立版本网址','success',release.id);return result;
}
export async function retireGatewayVersion(env,store,user,release) {
  const p=store.project(release.projectId),site=release.gateway;
  demand(site&&site.status!=='retired','此版本没有活动网关入口',409);
  demand(p.gateway?.versionId!==site.versionId,'当前版本不能停用，请先发布其他版本或暂停项目',409);
  const host=new URL(site.versionUrl).hostname;
  await deleteGatewayBinding(env,host,user.id,p.id);
  for(const f of site.files)await env.ARTIFACTS.delete(prefix(site.versionId)+'files/'+f.path);
  await env.ARTIFACTS.delete(prefix(site.versionId)+'manifest.json');
  site.status='retired';site.retiredAt=new Date().toISOString();p.gatewayVersions=(p.gatewayVersions||[]).filter(id=>id!==site.versionId);store.save();return {retired:true,chainUnchanged:true};
}
export async function recoverGatewayCatalog(env,store,user,project) {
  const host=gatewayProjectHost(project.id,env.GATEWAY_ROOT),record=await gatewayBinding(env,host);
  demand(record&&record.owner===user.id&&record.projectId===project.id&&record.gateway.status!=='deleted','网关归属不匹配',409);
  const r=store.release(record.releaseId);assertApproved(store,r);
  const obj=await env.ARTIFACTS.get(prefix(record.gateway.versionId)+'manifest.json');demand(obj,'网关清单不存在',409);const m=await obj.json();
  demand(m.owner===user.id&&m.releaseId===r.id&&m.manifestHash===r.manifestHash&&record.manifestHash===r.manifestHash,'网关版本归属不一致',409);
  const {schema,projectId,releaseId,target,blockNumber,blockHash,files,fallback,manifestHash}=m;
  demand(projectId===project.id&&digest({schema,projectId,releaseId,target,blockNumber,blockHash,files,fallback,manifestHash})===record.gateway.versionId,'网关清单完整性检查失败',409);
  const g={...record.gateway,stableUrl:'https://'+host,versionUrl:'https://'+record.gateway.versionHost,manifestUrl:'https://'+record.gateway.versionHost+'/__tapenow/manifest.json',blockNumber:m.blockNumber,blockHash:m.blockHash,manifestHash:m.manifestHash,nativeUrl:m.nativeUrl,mode:'pinned',files:m.files,bytes:m.files.reduce((n,f)=>n+f.bytes,0)};
  r.gateway=g;project.gateway={...g,releaseId:r.id};project.gatewayVersions=[...new Set([...(project.gatewayVersions||[]),g.versionId])];project.pendingPublications=(project.pendingPublications||[]).filter(x=>x.kind!=='gateway');store.save();return project.gateway;
}
export async function gatewayHealth(env,record,{identity=readGatewayIdentity}={}) {
  const g=record.gateway;
  try {
    const result=await identity(g.target);assertGatewayOwner(result,{target:{chainId:g.target.chainId,cpuIndex:g.target.cpuIndex,tokenId:g.target.tokenId},wallet:g.chainOwner});
    demand(result.container.toLowerCase()===g.target.container.toLowerCase(),'容器归属发生变化',409);
    return {...g,status:'active',leaseUntil:Date.now()+GATEWAY_LEASE_MS,paidUntil:result.paidUntil,checkedAt:result.checkedAt,error:null};
  }catch(e){return {...g,status:[403,409].includes(e.status)?'blocked':'degraded',checkedAt:new Date().toISOString(),error:e.status?e.message:'读链服务暂不可用'};}
}
export async function checkGatewayProject(env,store,user,project,{identity=readGatewayIdentity,readArtifact=readVerifiedArtifact,content=false}={}) {
  demand(project.gateway,'请先发布 Gateway 版本',409);
  const host=new URL(project.gateway.stableUrl).hostname,record=await gatewayBinding(env,host);
  demand(record&&record.owner===user.id&&record.projectId===project.id,'网关归属不匹配',409);
  const checked=await gatewayHealth(env,record,{identity});
  for(const d of [host,record.gateway.versionHost]){
    const r=await gatewayBinding(env,d);if(r&&r.owner===user.id&&r.projectId===project.id&&r.gateway.versionId===record.gateway.versionId&&r.gateway.status!=='deleted')await writeGatewayBinding(env,d,{...r,gateway:{...checked,alias:r.gateway.alias}},r);
  }
  project.gateway={...project.gateway,...checked};store.save();
  if(content){
    try{const report=await readArtifact(checked.target),snapshot=await env.ARTIFACTS.get(prefix(checked.versionId)+'manifest.json'),meta=await snapshot.json();project.gateway.contentCheck={status:report.fallback===meta.fallback&&report.files.length===project.gateway.files.length&&report.files.every(f=>project.gateway.files.some(p=>f.path===p.path&&f.sha256===p.sha256&&f.bytes===p.bytes&&f.contentType===p.contentType))?'unchanged':'changed',checkedAt:report.checkedAt,blockNumber:report.blockNumber};}
    catch{project.gateway.contentCheck={status:'unavailable',checkedAt:new Date().toISOString()};}
    store.save();
  }
  return project.gateway;
}
export async function serveGateway(request,env,ctx,{lookup=gatewayBinding,assertServing=assertProjectServing,cache=globalThis.caches?.default}={}) {
  const u=new URL(request.url),headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Opener-Policy':'same-origin','Origin-Agent-Cluster':'?1','Access-Control-Allow-Origin':'*'};
  if(u.protocol!=='https:')return new Response(null,{status:307,headers:{...headers,Location:'https://'+u.host+u.pathname+u.search}});
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers});
  let record=await lookup(env,u.hostname);if(!record?.gateway||record.gateway.status==='deleted')return new Response('Not found',{status:404,headers});
  if(record.gateway.status==='pending')return new Response('Domain verification required',{status:403,headers});
  if(record.gateway.customAlias){const current=await lookup(env,gatewayProjectHost(record.projectId,env.GATEWAY_ROOT));demand(current&&current.owner===record.owner&&current.projectId===record.projectId,'项目网关入口尚未就绪',503);record=current;}
  const g=record.gateway;await assertServing(env,record.owner,record.projectId);
  if(g.status==='blocked'||g.status==='pending')return new Response('Gateway ownership or domain verification required',{status:403,headers});
  if(g.leaseUntil<Date.now())return new Response('Gateway verification expired; retry later',{status:503,headers});
  if(g.paidUntil<Date.now())return new Response('TapeKit activation expired',{status:402,headers});
  const object=await env.ARTIFACTS.get(prefix(g.versionId)+'manifest.json');if(!object)return new Response('Verified snapshot unavailable',{status:503,headers});
  const manifest=await object.json();demand(manifest.owner===record.owner&&manifest.projectId===record.projectId&&manifest.manifestHash===record.manifestHash,'网关版本归属不一致',503);
  const {schema,projectId,releaseId,target,blockNumber,blockHash,files,fallback,manifestHash}=manifest;
  demand(digest({schema,projectId,releaseId,target,blockNumber,blockHash,files,fallback,manifestHash})===g.versionId,'网关清单完整性检查失败',503);
  Object.assign(headers,{'X-TapeNow-Project':record.projectId,'X-TapeNow-Chain':String(g.target.chainId),'X-TapeNow-Version':g.versionId,'X-TapeNow-Verification':g.status==='degraded'?'stale':'pinned','X-TapeNow-Checked-At':manifest.checkedAt});
  if(u.pathname==='/__tapenow/manifest.json'){const {owner,...publicManifest}=manifest;return Response.json({...publicManifest,health:{status:g.status,checkedAt:g.checkedAt,leaseUntil:g.leaseUntil,paidUntil:g.paidUntil}},{headers});}
  if(g.alias)return new Response(null,{status:307,headers:{...headers,Location:'https://'+g.versionHost+u.pathname+u.search}});
  const path=gatewayPath(u.pathname,manifest.files,manifest.fallback);if(path===null)return new Response('Not found',{status:404,headers});
  const file=manifest.files.find(f=>f.path===path),cacheKey=new Request('https://'+g.versionHost+'/'+path.split('/').map(encodeURIComponent).join('/')+'?sha256='+file.sha256);
  const hit=cache?await cache.match(cacheKey):null;
  let bytes;if(hit)bytes=await hit.arrayBuffer();else {const f=await env.ARTIFACTS.get(prefix(g.versionId)+'files/'+path);if(!f)return new Response('Snapshot file unavailable',{status:503,headers});bytes=await f.arrayBuffer();}
  // Verify storage/cache bytes too: a hash declaration alone is not integrity.
  demand(bytes.byteLength===file.bytes&&sha(Buffer.from(bytes))===file.sha256,'网关缓存完整性检查失败',503);
  if(!hit&&cache)ctx.waitUntil(cache.put(cacheKey,new Response(bytes,{headers:{'Cache-Control':'public, max-age=31536000, immutable'}})));
  // Revalidation preserves expiry/revocation even when the byte cache is warm.
  Object.assign(headers,{'Content-Type':responseContentType(file.contentType),'ETag':'"'+file.sha256+'"','Cache-Control':'public, max-age=0, must-revalidate, no-transform','X-TapeNow-Bytes':String(file.bytes)});
  // Prevent downstream HTML transformations; support weak validators and lists
  // because intermediaries may change the transfer encoding of a representation.
  if((request.headers.get('if-none-match')||'').split(',').some(v=>v.trim()==='*'||v.trim().replace(/^W\//,'')===headers.ETag))return new Response(null,{status:304,headers});
  return new Response(request.method==='HEAD'?null:bytes,{headers});
}
export async function scheduledGatewayChecks(env,{identity=readGatewayIdentity}={}) {
  if(!gatewayEnabled(env))return;
  const state=await env.ARTIFACTS.get('gateway/check-cursor.json'),cursor=state?(await state.json()).cursor:undefined;
  const page=await env.ARTIFACTS.list({prefix:'gateway/hosts/',cursor,limit:40});
  const identities=new Map();
  for(const obj of page.objects){const host=obj.key.slice('gateway/hosts/'.length,-5),record=await gatewayBinding(env,host);if(!record?.gateway||['pending','deleted'].includes(record.gateway.status)||record.gateway.customAlias)continue;
    const key=JSON.stringify(record.gateway.target),read=async target=>{if(!identities.has(key))identities.set(key,identity(target));return identities.get(key);};
    const checked=await gatewayHealth(env,record,{identity:read});try{await writeGatewayBinding(env,host,{...record,gateway:checked},record);}catch(e){if(e.status!==409)throw e;}
  }
  await env.ARTIFACTS.put('gateway/check-cursor.json',JSON.stringify({cursor:page.truncated?page.cursor:undefined,at:new Date().toISOString()}));
}
