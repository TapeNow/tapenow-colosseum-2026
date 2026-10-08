import { t, localeDate } from "./i18n";
let workspaceId=sessionStorage.getItem('tapenow-workspace')||'';
export const getWorkspace=()=>workspaceId;
export function setWorkspace(value:string){const changed=workspaceId!==value;workspaceId=value;currentCapabilities=null;sessionStorage.setItem('tapenow-workspace',value);if(changed&&typeof window!=='undefined')window.dispatchEvent(new Event('tapenow-workspace-changed'));}
import { verifyPagesManifest } from '../shared/pages-readback.mjs';
import type { Release } from './types';
let currentSession: any = {mode: "local"};
let currentCapabilities:any=null;
export const getCapabilities=()=>currentCapabilities;
export const canHost=(projectId?:string)=>!isCloud()||!!currentCapabilities&&(currentCapabilities.platformHosting===true||currentCapabilities.legacyProjects?.includes(projectId));
let previewUrls: Record<string,string> = {};
export const getSession = () => currentSession;
export const isCloud = () => currentSession.mode === "cloud";
export const hasVersionedSites = (projectId?:string) => currentSession.siteEnabled === true&&canHost(projectId);
export type AgentScope={actorId:string;ownerId:string};
export const captureAgentScope=():AgentScope|null=>currentSession.authenticated&&currentSession.user?.id?{actorId:currentSession.user.id,ownerId:workspaceId||currentSession.user.id}:null;
export function assertAgentScope(scope:AgentScope){const current=captureAgentScope();if(!current||current.actorId!==scope.actorId||current.ownerId!==scope.ownerId)throw Object.assign(Error('Agent context changed'),{httpStatus:409});}
export async function agentApi<T=any>(scope:AgentScope,path:string,body?:unknown,method?:string):Promise<T>{
  assertAgentScope(scope);
  const response=await fetch('/api'+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json','X-Deweb-Token':token,'X-TapeNow-Workspace':scope.ownerId,'X-TapeNow-Agent-Actor':scope.actorId,'X-TapeNow-Agent-Workspace':scope.ownerId},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();assertAgentScope(scope);
  if(response.status===401)window.dispatchEvent(new Event('tapenow-signed-out'));
  if(!response.ok)throw Object.assign(Error(data.error||'Agent action failed'),{httpStatus:response.status,code:data.code});
  return data;
}
if(typeof window!=="undefined")window.addEventListener("tapenow-signed-out",()=>{setWorkspace("");sessionStorage.removeItem("tapenow-workspace-actor");});
let token = "",
  previewPort = 4312;
export async function initialize() {
  const response = await fetch("/api/session");
  if (!response.ok) throw Error(t("工作台服务无法访问"));
  const data = await response.json();
  const actor=data.user?.id||"";
  const priorActor=sessionStorage.getItem("tapenow-workspace-actor")||"";
  if(!actor||actor!==priorActor)setWorkspace("");
  sessionStorage.setItem("tapenow-workspace-actor",actor);
  currentSession = data;
  token = data.token;
  previewPort = data.previewPort;
  return data;
}
const inFlight=new Map<string,Promise<any>>();
export async function api<T=any>(path:string,body?:unknown,method?:string):Promise<T>{
  const verb=method||(body===undefined?'GET':'POST');
  const tracked=verb==='POST'&&(new RegExp('/projects/[^/]+/(import|sample|restore)$').test(path)||new RegExp('/releases/[^/]+/(verify|chain/(prepare|readback))$').test(path)||path.endsWith('/gateway/check'));
  if(!tracked)return apiRequest(path,body,method);
  const signature=workspaceId+':'+path+':'+JSON.stringify(body),fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature))),b=>b.toString(16).padStart(2,'0')).join('');
  if(inFlight.has(fingerprint))return inFlight.get(fingerprint)!;
  const storageKey='tapenow-operation:'+fingerprint,key=sessionStorage.getItem(storageKey)||crypto.randomUUID();sessionStorage.setItem(storageKey,key);
  const pending=apiRequest<T>(path,body,method,key).then(result=>{sessionStorage.removeItem(storageKey);return result;}).catch(error=>{if(error.httpStatus&&error.httpStatus<500&&error.code!=='operation_in_progress')sessionStorage.removeItem(storageKey);throw error;}).finally(()=>{inFlight.delete(fingerprint);});
  inFlight.set(fingerprint,pending);return pending;
}
async function apiRequest<T = any>(
  path: string,
  body?: unknown,
  method?: string,
  operationKey?:string,
): Promise<T> {
  if(["/auth/logout","/auth/password","/auth/verify"].includes(path))setWorkspace("");
  const response = await fetch("/api" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", "X-Deweb-Token": token, ...(workspaceId?{"X-TapeNow-Workspace":workspaceId}:{}),...(operationKey?{'X-TapeNow-Operation-Key':operationKey}:{}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if(response.status===401 && !path.startsWith("/auth/"))window.dispatchEvent(new Event("tapenow-signed-out"));
    throw Object.assign(Error(data.error || t("操作失败")),{httpStatus:response.status,code:data.code});
  }
  if(path === "/state") {
    currentCapabilities=data.capabilities?{...data.capabilities,usage:data.usage}:null;
    previewUrls={};
    for(const r of data.releases || []){if(r.nativeAccess?.status==='observed'&&r.activation?.live)previewUrls[r.id]=r.nativeAccess.url;if(r.gateway?.status==="active")previewUrls[r.id]=r.gateway.versionUrl;if(r.preview?.url)previewUrls[r.id]=r.preview.url;if(r.site?.url)previewUrls[r.id]=r.site.url;if(r.privatePreview?.status==="active")previewUrls[r.id]=r.privatePreview.url;}
    for(const p of data.projects || []){if(p.productionId&&previewUrls[p.productionId])previewUrls[p.id]=previewUrls[p.productionId];if(p.gateway?.status==="active")previewUrls[p.id]=p.gateway.stableUrl;}
  }
  return data;
}
export async function cloudflareOperation(release:Release,production:boolean,upload=true) {
  const path='/releases/'+release.id+'/cloudflare';
  const record=await api(path+(upload?'':'/verify'),{production});
  if(isCloud() && production && record.status==='pending-browser-verification') {
    const probe=await verifyPagesManifest('https://'+record.projectName+'.pages.dev',{files:release.files,removed:record.verification.removedPaths||[]});
    return api(path+'/access',{deploymentId:record.deploymentId,checkId:record.browserCheckId,failedPaths:probe.failed.map(f=>f.path)});
  }
  return record;
}
export const bytes = (n: number) =>
  n < 1024
    ? n + " B"
    : n < 1048576
      ? (n / 1024).toFixed(1) + " KB"
      : (n / 1048576).toFixed(2) + " MB";
export const short = (s: string, n = 8) => s.slice(0, n);
export const date = (s: string) =>
  localeDate(s, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export const preview = (projectId: string, releaseId?: string) =>
  isCloud() ? (previewUrls[releaseId || projectId] || "/api/preview/"+projectId+(releaseId?"/"+releaseId:"")) : "http://" +
  (releaseId ? releaseId + "." : "") +
  projectId +
  ".localhost:" +
  previewPort +
  "/";
export async function file64(file: File) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  for (const b of new Uint8Array(buffer)) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function publishVersionedSite(release:Release,retry=false) {
  const site=await api('/releases/'+release.id+(retry?'/site-check':'/publish-site'),{});
  const failedPaths:string[]=[];let index=0,stableEntry=false;
  await Promise.all(Array.from({length:Math.min(4,release.files.length)},async()=>{
    while(index<release.files.length){const f=release.files[index++];try{
      const r=await fetch(site.url+'/'+f.path.split('/').map(encodeURIComponent).join('/'),{credentials:'omit',signal:AbortSignal.timeout(12000)});
      const bytes=await r.arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if(!r.ok||hash!==f.sha256||bytes.byteLength!==f.bytes)failedPaths.push(f.path);
    }catch{failedPaths.push(f.path);}}
  }));
  try{const r=await fetch(site.stableUrl+'/',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12000)});stableEntry=r.ok&&r.url===site.url+'/';await r.body?.cancel();}catch{}
  return api('/releases/'+release.id+'/site-access',{checkId:site.checkId,failedPaths,stableEntry});
}

export async function verifyDomainManifest(hostname:string,files:Release['files'],{fetchImpl=fetch}:{fetchImpl?:typeof fetch}={}) {
  if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)||files.length<1||files.length>500||files.reduce((n,f)=>n+f.bytes,0)>10*1024*1024)throw Error(t('域名访问检查参数无效'));
  const origin='https://'+hostname,failedPaths:string[]=[];let next=0;
  const signal=AbortSignal.timeout(55000);
  await Promise.all(Array.from({length:Math.min(4,files.length)},async()=>{
    while(next<files.length){const file=files[next++];let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
      try{
        if(file.path.split('/').some(part=>!part||part==='.'||part==='..')||file.bytes<0||!Number.isSafeInteger(file.bytes)||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('invalid');
        const url=origin+'/'+file.path.split('/').map(encodeURIComponent).join('/');
        const response=await fetchImpl(url,{credentials:'omit',cache:'no-store',redirect:'error',signal});
        if(response.status!==200||response.url!==url||response.redirected||!response.body)throw Error('response');
        reader=response.body.getReader();let size=0;const parts:Uint8Array[]=[];
        for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>file.bytes)throw Error('size');parts.push(value);}
        if(size!==file.bytes)throw Error('size');const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==file.sha256)throw Error('hash');
      }catch{failedPaths.push(file.path);}finally{await reader?.cancel().catch(()=>{});}
    }
  }));
  return {failedPaths,httpsVerified:failedPaths.length===0};
}
export async function hashportOperation(domain:{id:string;hostname:string},release:Release) {
  const verified=await api<any>('/domains/'+domain.id+'/chain-verify',{releaseId:release.id}),check=verified.browserCheck;
  if(verified.status==='active'&&verified.verification?.manifestHash===release.manifestHash&&verified.verification?.https?.verified===true&&verified.verification.https.hostname===domain.hostname&&verified.accessCheck?.scope==='private-node-checker')return verified;
  if(!check||check.releaseId!==release.id||check.manifestHash!==release.manifestHash||check.hostname!==domain.hostname||check.chainId!==56||!Number.isFinite(Number(check.expiresAt))||Number(check.expiresAt)<=Date.now())throw Error(t('域名访问检查已失效，请重新核验'));
  const access=await verifyDomainManifest(domain.hostname,release.files);
  if(!access.httpsVerified)throw Error(t('链上与 DNS 已核验，但浏览器 HTTPS 文件检查未通过。请检查证书、CORS 和文件内容后重试；域名仍待访问核验。'));
  const result=await api<any>('/domains/'+domain.id+'/chain-access',{releaseId:release.id,checkId:check.id,...access});
  if(result.status!=='active')throw Error(t('域名仍待访问核验'));
  return result;
}
