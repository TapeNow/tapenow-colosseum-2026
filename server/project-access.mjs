import {demand} from './core.mjs';
// Signed receipts contain the owner's configuration snapshot; never redact a signed payload.
const readRelease=new Set(['readiness','restore-check','files','chain/plan','dependencies']);
const writeRelease=new Set(['approve','verify','archive-restore','preview','private-preview','private-preview/revoke','site-check','site-access','publish-site','cloudflare','cloudflare/verify','cloudflare/access','chain/prepare','chain/preflight','chain/intent','chain/rejected','chain/pending','chain/confirm','chain/costs','chain/readback','chain/activation','gateway/prepare','gateway/publish']);
writeRelease.add('gateway/restore');
writeRelease.add('native-access/prepare');
writeRelease.add('native-access/confirm');
const writeProject=new Set(['import','promote','restore','github-build','github-artifact','vercel-import','container/resolve','chain-import']);
const readProject=new Set(['source-jobs','diagnostics','retention','data-connections','ecosystem','gateway']);
export function authorizeProjectRequest(store,{actorId,ownerId,memberships=[]},method,path,body={}) {
  const owner=actorId===ownerId,read=['GET','HEAD'].includes(method),ids=new Set();
  const project=path.match(/^\/api\/projects\/([^/]+)(?:\/(.*))?$/),release=path.match(/^\/api\/releases\/([^/]+)\/(.+)$/),job=path.match(/^\/api\/source-jobs\/([^/]+)(?:\/(.*))?$/),preview=path.match(/^\/api\/preview\/([^/]+)(?:\/([^/]+))?$/);
  const domain=path.match(/^\/api\/domains\/([^/]+)(?:\/.*)?$/);
  if(domain){const d=store.state.domains?.find(d=>d.id===domain[1]);demand(d,'域名不存在',404);ids.add(d.projectId);}
  const connection=path.match(/^\/api\/connections\/([^/]+)$/);
  if(connection){const c=store.state.connections?.[decodeURIComponent(connection[1])];demand(c,'连接不存在',404);ids.add(c.projectId);}
  if(project)ids.add(store.project(project[1]).id);
  if(release)ids.add(store.release(release[1]).projectId);
  if(job){const j=store.state.sourceJobs?.[job[1]];demand(j,'任务不存在',404);ids.add(j.projectId);}
  if(preview){ids.add(store.project(preview[1]).id);if(preview[2])ids.add(store.release(preview[2]).projectId);}
  // IDs from the body cannot widen the route's authorization, even across two shared projects.
  for(const key of ['projectId','pid'])if(body[key])ids.add(store.project(body[key]).id);
  for(const key of ['releaseId','rid'])if(body[key])ids.add(store.release(body[key]).projectId);
  if(Array.isArray(body.releaseIds))for(const rid of body.releaseIds)ids.add(store.release(rid).projectId);
  demand(ids.size<=1,'项目与资源不匹配',403);
  const projectId=[...ids][0];
  if(owner)return {owner:true,projectId,role:'owner'};
  if(read&&['/api/state','/api/ecosystem/health','/api/keys','/api/capabilities','/api/operations','/api/resources'].includes(path))return {owner:false,role:'member'};
  const grant=memberships.find(m=>m.project_id===projectId&&['publisher','viewer'].includes(m.role));
  demand(grant,'无此项目访问权限',403);
  // Explicit routes only: OAuth, accounts, connections, environment, sample generation,
  // exports and vendor configuration are intentionally absent.
  const allowed=read&&(project&&readProject.has(project[2])||release&&readRelease.has(release[2])||preview||job&&!job[2]) || !read&&method==='POST'&&(project&&writeProject.has(project[2])||release&&writeRelease.has(release[2])||job&&job[2]==='import');
  demand(allowed||method==='PUT'&&release?.[2]==='dependencies','成员无此接口权限',403);
  demand(read||grant.role==='publisher','Viewer 只能读取项目',403);
  if(project?.[2]==='github-build')demand(['buildCommand','rootDirectory','outputDirectory'].every(k=>body[k]===undefined),'成员不能更改供应商构建配置',403);
  // Polling this legacy GET updates vendor job status; viewers receive a cached snapshot in the worker.
  return {owner:false,role:grant.role,projectId};
}
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
export function sharedState(store,memberships){
  const ids=new Set(memberships.map(m=>m.project_id));
  const visible=typeof store.publicState==='function'?store.publicState():store.state;
  return {schema:visible.schema,projects:visible.projects.filter(p=>ids.has(p.id)).map(p=>({...pick(p,['id','name','description','createdAt','updatedAt','productionId','siteProductionId','cloudflareProductionId','chain','databaseVersion','repository','gateway','nativeProductionId']),environment:[],repository:p.repository||null,role:memberships.find(m=>m.project_id===p.id).role})),
    releases:visible.releases.filter(r=>ids.has(r.projectId)).map(r=>memberResponse({...pick(r,['id','projectId','label','createdAt','manifestHash','status','environment','chainStatus','bytes','archive','workflow','budgetSummary','transactions','checks','nativeAccess','activation','cloudflare','cloudflareProduction','preview','site','privatePreview','gateway','restoredFrom','publicExposure','databaseContract','verification']),files:(r.files||[]).map(f=>pick(f,['path','bytes','sha256','contentType'])),source:pick(r.source||{type:'unknown'},['type','commit','repository']),checks:r.checks||[],transactions:r.transactions||[]})),
    logs:visible.logs.filter(l=>ids.has(l.projectId)).map(l=>pick(l,['id','projectId','releaseId','message','level','createdAt','time','at','actorId'])),connections:{},domains:[],visits:[],preferences:{}};
}
export function auditAuthorization(store,actorId,projectId,method,path){
  store.state.accessAudit||=[];store.state.accessAudit.push({actorId,projectId:projectId||null,method,path,at:new Date().toISOString()});
  store.state.accessAudit=store.state.accessAudit.slice(-1000);store.save();
}
export function assertNotSuspended(status){demand(!status?.suspended,'项目已暂停：'+(status?.reason||'请联系所有者'),423);}

export function memberResponse(value,{allowConnections=false,allowPassword=false}={}){
  if(Array.isArray(value))return value.map(v=>memberResponse(v));
  if(!value||typeof value!=='object')return value;
  const blocked=new Set(['secrets','credentials','accessToken','refreshToken','access_token','refresh_token','token','password','oauth','oauthPending','oauthGrants','accounts','connections','environment','base64','accountBytes','accountLimit','privateKey','secret','grantId','reference']);
  const cleanConfiguration=v=>v===null?null:{...pick(v,['chain','domains','databaseVersion']),environment:[],connections:[]};
  return Object.fromEntries(Object.entries(value).filter(([k,v])=>!blocked.has(k)||k==='connections'&&allowConnections||k==='password'&&allowPassword||k==='environment').map(([k,v])=>[k,['configuration','artifactConfiguration','previousConfiguration'].includes(k)?cleanConfiguration(v):k==='environment'&&typeof v!=='string'?[]:memberResponse(v)]));
}
