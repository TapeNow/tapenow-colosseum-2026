import {demand} from './core.mjs';
import {archiveBytes} from './archive-policy.mjs';
import {publicationUsage} from './publication-quota.mjs';

export const BETA_LIMITS=Object.freeze({projects:30,releases:150,archiveBytes:250*1024*1024,previewHours:24,previewLifetimeHours:168,previewRequests:10000,previewBytes:100*1024*1024});
// D35: workspaces opened through public-beta sign-up use the free plan; invited
// accounts keep BETA_LIMITS. Over-limit data created earlier is kept, not deleted.
export const FREE_LIMITS=Object.freeze({...BETA_LIMITS,projects:3,releases:9,archiveBytes:100*1024*1024,monthlyPublications:10});
export const planLimits=plan=>plan==='free'?FREE_LIMITS:BETA_LIMITS;
const entries=value=>String(value||'').split(',').map(x=>x.trim()).filter(Boolean);
// Persist the grandfathered projects once, before processing the first A request.
// Neither an actor's role nor a request body can grant platform hosting rights.
export function initializeBetaPolicy(store,time=Date.now(),persist=true) {
  if(store.state.betaPolicy)return;
  store.state.betaPolicy={schema:1,at:new Date(time).toISOString(),legacyProjects:store.state.projects.filter(p=>p.siteProductionId||p.gateway||p.pendingPublications?.some(x=>['site','gateway'].includes(x.kind))).map(p=>p.id)};
  if(persist)store.save();
}
export function betaCapabilities(env,user,store,plan='beta') {
  const internal=env.BETA_PHASE!=='A'||entries(env.PLATFORM_HOSTING_OWNERS).includes(user.id)||!!user.email&&entries(env.OPERATOR_EMAILS).map(x=>x.toLowerCase()).includes(user.email.toLowerCase());
  const legacyProjects=store.state.betaPolicy?.legacyProjects||[];
  return {schema:'tapenow-capabilities/v1',phase:internal?'internal':'A',platformHosting:internal,legacyProjects,privatePreview:true,customerCloudflare:true,nativeEntry:true,hashportChains:[56],plan:internal?'beta':plan,limits:internal?BETA_LIMITS:planLimits(plan),webmcpRegistered:true,webmcpRequiresNativeBrowser:true};
}
export function hostingAllowed(capabilities,projectId){return capabilities.platformHosting||capabilities.legacyProjects.includes(projectId);}
export function assertBetaAction(capabilities,projectId,method,path,body={}) {
  if(['GET','HEAD'].includes(method))return;
  const platform=path.endsWith('/publish-site')||new RegExp('/gateway/(prepare|publish|restore)$').test(path)||new RegExp('/gateway-prepare$').test(path)||path.endsWith('/domains')&&body.provider==='gateway';
  if(platform)demand(hostingAllowed(capabilities,projectId),'A 公测使用 TapeKit、已验证第三方或您自己的 Cloudflare；平台长期托管暂未开放',403);
  if(new RegExp('/releases/[^/]+/preview$').test(path))demand(capabilities.platformHosting,'A 公测请使用有期限和用量上限的私有预览，或您自己的 Cloudflare',403);
}
export function isRecoveryAction(method,path) {
  return ['GET','HEAD','DELETE'].includes(method)||new RegExp('/(chain/(pending|confirm|costs|rejected)|private-preview/revoke|archive-restore|trash|suspension|gateway/retire|gateway-disconnect)$').test(path);
}
export function betaUsage(store,daily={count:0},limit=300,limits=BETA_LIMITS) {
  const size=store.state.releases.reduce((n,r)=>n+archiveBytes(r),0);
  return {projects:store.state.projects.length,archives:store.state.releases.filter(r=>r.archive?.state!=='purged').length,archiveBytes:size,dailyOperations:daily.count||0,dailyLimit:limit,remainingOperations:Math.max(0,limit-(daily.count||0)),monthlyPublications:publicationUsage(store,limits),limits};
}
