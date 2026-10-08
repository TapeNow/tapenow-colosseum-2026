// Public reads work cross-origin. Mutations use a signed-in TapeNow session,
// a fresh CSRF token and the same permission checks as the dashboard.
export async function readGatewayManifest(url,{fetcher=fetch}={}) {
 const u=new URL('/__tapenow/manifest.json',url);if(u.protocol!=='https:')throw Error('HTTPS required');
 const r=await fetcher(u,{cache:'no-store',redirect:'error'});if(!r.ok)throw Error('Gateway proof unavailable: '+r.status);const m=await r.json();
 if(m.schema!=='tapenow-gateway/v1'||!['56','196','8453'].includes(String(m.target?.chainId)))throw Error('Unsupported gateway proof');return m;
}
export async function verifyGatewayFile(url,file,{fetcher=fetch}={}) {
 if(!file?.path||file.path.startsWith('/')||file.path.split('/').some(s=>s==='..'||s.startsWith('.'))||/[\\?#%]/.test(file.path))throw Error('Unsafe file path');
 const base=new URL(url);if(base.protocol!=='https:')throw Error('HTTPS required');
 const target=new URL('/'+file.path.split('/').map(encodeURIComponent).join('/'),base);
 const response=await fetcher(target,{cache:'no-store',redirect:'error'});if(!response.ok)throw Error('Gateway file unavailable: '+response.status);
 const bytes=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(bytes.byteLength!==file.bytes||hash!==file.sha256)throw Error('Gateway file integrity mismatch');return {verified:true,bytes:bytes.byteLength,sha256:hash};
}
export function createGatewayClient({origin=globalThis.location?.origin,csrf,workspace,fetcher=fetch}={}) {
 const base=new URL(origin);if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw Error('HTTPS required');
 const id=(value,prefix)=>{if(!new RegExp('^'+prefix+'-[a-f0-9]{12}$').test(value))throw Error('Invalid resource ID');return value;};
 const request=async(path,body)=>{if(body!==undefined&&!csrf)throw Error('Fresh CSRF token required');const r=await fetcher(new URL('/api'+path,base),{method:body===undefined?'GET':'POST',credentials:'include',redirect:'error',headers:{'Content-Type':'application/json',...(csrf?{'X-Deweb-Token':csrf}:{}),...(workspace?{'X-TapeNow-Workspace':workspace}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const v=await r.json();if(!r.ok)throw Error(v.error||'Gateway request failed');return v;};
 return {
 capabilities:()=>request('/gateway/capabilities'),
 project:projectId=>request('/projects/'+id(projectId,'p')+'/gateway'),
 prepare:(releaseId,wallet)=>request('/releases/'+id(releaseId,'d')+'/gateway/prepare',{wallet}),
 publish:(releaseId,proof)=>request('/releases/'+id(releaseId,'d')+'/gateway/publish',proof),
 restore:(releaseId,proof)=>request('/releases/'+id(releaseId,'d')+'/gateway/restore',proof),
 retire:releaseId=>request('/releases/'+id(releaseId,'d')+'/gateway/retire',{}),
 check:projectId=>request('/projects/'+id(projectId,'p')+'/gateway/check',{content:true}),
 recover:projectId=>request('/projects/'+id(projectId,'p')+'/gateway/recover',{}),
 prepareDomain:domainId=>request('/domains/'+id(domainId,'dom')+'/gateway-prepare',{}),
 verifyDomain:domainId=>request('/domains/'+id(domainId,'dom')+'/gateway-check',{}),
 disconnectDomain:domainId=>request('/domains/'+id(domainId,'dom')+'/gateway-disconnect',{})
 };
}
