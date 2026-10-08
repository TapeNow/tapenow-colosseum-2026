import {randomBytes} from 'node:crypto';
import {demand,id,now} from './core.mjs';
import {digest,readiness,approvalDigest,approveRelease,restoreCheck,publicationStatus,budgetSummary,configurationSnapshot} from './release-policy.mjs';
import {CHAINS} from './chains.mjs';
import {memberResponse} from './project-access.mjs';

const PID=/^p-[a-f0-9]{12}$/,RID=/^d-[a-f0-9]{12}$/,JID=/^job-[a-f0-9]{12}$/,OID=/^op-[a-f0-9]{12}$/;
const KEY=/^[a-zA-Z0-9_-]{16,80}$/;
const short=value=>String(value||'').slice(0,200);
export const AGENT_ACTIONS=['private_preview','restore','publish_chain','publish_cloudflare','verify_content','revoke_preview','start_github_build','import_build'];
export function strictObject(value,allowed,required=[]){
  demand(value&&typeof value==='object'&&!Array.isArray(value),'Invalid tool arguments',400);
  demand(Object.keys(value).every(k=>allowed.includes(k))&&required.every(k=>value[k]!==undefined),'Unknown or missing tool argument',400);
}
export function pruneAgentRecords(store,time=Date.now()){
  let removed=0;
  for(const [key,q]of Object.entries(store.state.agentActions||{}))if(Date.parse(q.createdAt)<time-7*86400000){delete store.state.agentActions[key];removed++;}
  for(const [key,q]of Object.entries(store.state.agentRequests||{}))if(q.at<time-7*86400000){delete store.state.agentRequests[key];removed++;}
  if(removed)store.save();return removed;
}
const keyCheck=value=>demand(typeof value==='string'&&KEY.test(value),'Invalid request ID',400);
const target=(method,path,body={})=>({method,path,body});
function references(store,input){
  if(input.releaseId){demand(RID.test(input.releaseId),'Invalid release ID',400);const r=store.release(input.releaseId);if(input.projectId)demand(r.projectId===input.projectId,'Project mismatch',403);return {r,p:store.project(r.projectId)};}
  if(input.jobId){demand(JID.test(input.jobId),'Invalid build ID',400);const job=store.state.sourceJobs?.[input.jobId];demand(job,'Build not found',404);if(input.projectId)demand(job.projectId===input.projectId,'Project mismatch',403);return {job,p:store.project(job.projectId)};}
  demand(PID.test(input.projectId||''),'Invalid project ID',400);return {p:store.project(input.projectId)};
}
export function actionTarget(store,input){
  const {action}=input,{p,r,job}=references(store,input);
  switch(action){
    case 'private_preview':demand(r,'Release required');return target('POST','/api/releases/'+r.id+'/private-preview',{hours:input.hours??24});
    case 'restore':demand(r,'Release required');return target('POST','/api/projects/'+p.id+'/restore',{releaseId:r.id});
    case 'publish_chain':demand(r,'Release required');return target('POST','/api/releases/'+r.id+'/chain/prepare',{from:input.wallet});
    case 'publish_cloudflare':demand(r,'Release required');return target('POST','/api/releases/'+r.id+'/cloudflare',{production:true});
    case 'verify_content':demand(r,'Release required');return target('POST','/api/releases/'+r.id+'/chain/readback');
    case 'revoke_preview':demand(r,'Release required');return target('POST','/api/releases/'+r.id+'/private-preview/revoke');
    case 'start_github_build':return target('POST','/api/projects/'+p.id+'/github-build',input.ref?{ref:input.ref}:{});
    case 'import_build':demand(job,'Build required');return target('POST','/api/source-jobs/'+job.id+'/import');
    default:demand(false,'Unsupported agent action',400);
  }
}
export function safeRelease(store,r){
  const ready=readiness(store,r),p=store.project(r.projectId),budget=budgetSummary(r);
  return {releaseId:r.id,projectId:r.projectId,untrusted:{label:short(r.label)},manifestHash:r.manifestHash,bytes:r.bytes,fileCount:r.files.length,
    archive:r.archive?.state||'available',chainStatus:r.chainStatus,chain:{chainId:p.chain.chainId,cpuIndex:p.chain.cpuIndex,tokenId:p.chain.tokenId,container:p.chain.container||null},
    readiness:{approved:ready.approved,buildChanged:ready.buildChanged,compatibility:ready.compatibility.status},workflow:publicationStatus(store,r),
    budget:{nativeSymbol:budget.nativeSymbol,capNative:budget.capNative,spentNative:budget.spentNative,unknown:budget.unknown},
    preview:r.privatePreview?{status:r.privatePreview.status,url:r.privatePreview.url,expiresAt:r.privatePreview.expiresAt}:null,
    native:r.nativeAccess?{status:r.nativeAccess.status,url:r.nativeAccess.url,scope:r.nativeAccess.scope}:null,
    verification:r.verification?{chainId:r.verification.chainId,block:r.verification.block,verifiedAt:r.verification.verifiedAt}:null,restoredFrom:r.restoredFrom||null};
}
const safeJob=j=>({jobId:j.id,projectId:j.projectId,status:j.status,commit:j.commit,releaseId:j.releaseId||null,untrusted:{repository:short(j.repository)}});
export function publicAgentAction(q){
  const status=!q.dispatchedAt&&q.expiresAt<=Date.now()&&['needs_user_action','approved'].includes(q.status)?'expired':q.status;
  return {operationId:q.id,action:q.input.action,projectId:q.projectId,releaseId:q.input.releaseId||null,status,createdAt:q.createdAt,expiresAt:q.expiresAt,
    summary:q.summary,result:q.result||null};
}
async function binding(ctx,input){
  const permission=await ctx.guard(actionTarget(ctx.store,input)),{p,r,job}=references(ctx.store,input);
  const member=ctx.memberships.find(m=>m.project_id===p.id);
  return digest({actor:ctx.actorId,owner:ctx.ownerId,role:permission.role,membership:member?.updated_at||null,
    suspension:permission.suspension?.updated_at||null,phase:ctx.capabilities.phase,input,
    configuration:r?approvalDigest(ctx.store,r):configurationSnapshot(ctx.store,p.id),
    manifest:r?.manifestHash,preview:['private_preview','revoke_preview'].includes(input.action)?r?.privatePreview||null:undefined,job:job?{id:job.id,commit:job.commit,repository:job.repository}:null});
}
function validatePrepare(input){
  const fields=['action','projectId','releaseId','jobId','expectedManifestHash','hours','wallet','maximumNative','ref','requestId'];
  strictObject(input,fields,['action','requestId']);keyCheck(input.requestId);demand(AGENT_ACTIONS.includes(input.action),'Unsupported agent action',400);
  if(input.action==='start_github_build')demand(input.projectId&&!input.releaseId&&!input.jobId&&!input.expectedManifestHash,'Build requires only a project reference',400);
  else if(input.action==='import_build')demand(input.jobId&&!input.releaseId&&!input.expectedManifestHash,'Import requires a build reference',400);
  else demand(input.releaseId&&input.expectedManifestHash&&!input.jobId,'Release and manifest references required',400);
  const relevant={private_preview:['hours'],publish_chain:['wallet','maximumNative'],start_github_build:['ref']};
  for(const key of ['hours','wallet','maximumNative','ref'])demand(input[key]===undefined||(relevant[input.action]||[]).includes(key),'Argument does not apply to action',400);
  if(input.action==='private_preview')demand(Number.isInteger(input.hours??24)&&(input.hours??24)>=1&&(input.hours??24)<=168,'Invalid preview duration',400);
  if(input.action==='publish_chain'){
    demand(/^0x[a-fA-F0-9]{40}$/.test(input.wallet||''),'Wallet address required',400);
    demand(typeof input.maximumNative==='string'&&/^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,18})?$/.test(input.maximumNative)&&Number(input.maximumNative)>0,'Exact positive native budget required',400);
  }
  if(input.ref!==undefined)demand(typeof input.ref==='string'&&/^[\w./-]{1,160}$/.test(input.ref)&&!input.ref.includes('..'),'Invalid ref',400);
}
function registry(store){store.state.agentActions||={};return store.state.agentActions;}
function lookup(ctx,oid){
  demand(OID.test(oid||''),'Invalid operation ID',400);const q=ctx.store.state.agentActions?.[oid];
  demand(q&&q.actorId===ctx.actorId&&q.ownerId===ctx.ownerId,'Operation unavailable',404);return q;
}
async function ensureCurrent(ctx,q,{approval=false}={}){
  demand(!['cancelled','expired'].includes(q.status),'Operation cancelled or expired',409);
  demand(q.expiresAt>Date.now(),'Operation approval expired; prepare again',409);
  demand(q.binding===await binding(ctx,q.input),'Operation scope changed; prepare again',409);
  if(approval)demand(q.approvedAt&&q.approvedDigest===q.binding,'User review required',409);
}
function pruneRegistry(store){
  const rows=registry(store);for(const [key,q]of Object.entries(rows))if(Date.parse(q.createdAt)<Date.now()-7*86400000)delete rows[key];
  demand(Object.keys(rows).length<500,'Agent operation allowance reached',429);
}
const safeErrorCode=status=>({400:'invalid_arguments',401:'sign_in_required',403:'permission_denied',404:'resource_unavailable',409:'review_or_reconciliation_required',423:'project_suspended',429:'quota_reached'}[status]||'operation_incomplete');
export async function handleAgentRequest(ctx,{method,path,body,searchParams}){
  const {store}=ctx;
  if(method==='GET'&&path==='/api/agent/context'){
    await ctx.guard(target('GET','/api/state'));
    const projects=store.state.projects.filter(p=>ctx.actorId===ctx.ownerId||ctx.memberships.some(m=>m.project_id===p.id));
    return {status:'verified',schema:'tapenow-agent/v1',workspaceId:ctx.ownerId,shared:ctx.actorId!==ctx.ownerId,phase:ctx.capabilities.phase,
      capabilities:{...ctx.capabilities,legacyProjects:ctx.capabilities.legacyProjects.filter(id=>projects.some(p=>p.id===id)),webmcpRegistered:true},
      projects:projects.slice(0,30).map(p=>({projectId:p.id,untrusted:{name:short(p.name)},role:ctx.actorId===ctx.ownerId?'owner':ctx.memberships.find(m=>m.project_id===p.id).role,chainId:p.chain.chainId,currentReleaseId:p.productionId})),
      actions:Object.values(store.state.agentActions||{}).filter(q=>q.actorId===ctx.actorId&&projects.some(p=>p.id===q.projectId)).slice(-20).map(publicAgentAction),usage:ctx.actorId===ctx.ownerId?ctx.usage:null};
  }
  let match=path.match(/^\/api\/agent\/(projects|releases|jobs)\/([^/]+)$/);
  if(method==='GET'&&match){
    const [_,kind,key]=match;
    if(kind==='projects'){
      demand(PID.test(key),'Invalid project ID',400);const access=await ctx.guard(target('GET','/api/projects/'+key+'/diagnostics'));
      const p=store.project(key),offset=Number(searchParams?.get('offset')||0),history=store.state.releases.filter(r=>r.projectId===key);demand(Number.isSafeInteger(offset)&&offset>=0&&offset<=100000,'Invalid offset',400);
      return {status:'verified',projectId:key,role:access.role,untrusted:{name:short(p.name)},chain:p.chain,nextOffset:offset+30<history.length?offset+30:null,
        releases:history.slice(offset,offset+30).map(r=>({releaseId:r.id,untrusted:{label:short(r.label)},manifestHash:r.manifestHash,bytes:r.bytes,chainStatus:r.chainStatus,workflowStatus:publicationStatus(store,r).status})),
        builds:Object.values(store.state.sourceJobs||{}).filter(j=>j.projectId===key).slice(-20).map(safeJob),
        connections:Object.values(store.state.connections||{}).filter(c=>c.projectId===key&&c.provider!=='secret').map(c=>({provider:c.provider,environment:c.environment,status:c.status}))};
    }
    if(kind==='releases'){
      demand(RID.test(key),'Invalid release ID',400);await ctx.guard(target('GET','/api/releases/'+key+'/readiness'));const r=store.release(key);
      const offset=Number(searchParams?.get('offset')||0);demand(Number.isSafeInteger(offset)&&offset>=0&&offset<=500,'Invalid offset',400);
      return {status:'verified',...safeRelease(store,r),files:r.files.slice(offset,offset+30).map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256})),nextOffset:offset+30<r.files.length?offset+30:null};
    }
    demand(JID.test(key),'Invalid build ID',400);await ctx.guard(target('GET','/api/source-jobs/'+key));return {status:'verified',build:safeJob(store.state.sourceJobs[key])};
  }
  match=path.match(/^\/api\/agent\/jobs\/(job-[a-f0-9]{12})\/poll$/);
  if(method==='POST'&&match){
    strictObject(body,[]);const job=store.state.sourceJobs?.[match[1]];demand(job,'Build unavailable',404);
    await ctx.guard(target('POST','/api/source-jobs/'+job.id+'/import'));await ctx.admit();
    const response=await ctx.call(target('GET','/api/source-jobs/'+job.id),{admitted:true});
    return response.status<400?{status:['built','imported'].includes(response.data.status)?'verified':'running',build:safeJob(response.data)}:{status:'blocked',code:safeErrorCode(response.status)};
  }
  if(method==='POST'&&path==='/api/agent/prepare'){
    validatePrepare(body);const {p,r,job}=references(store,body),current=await binding(ctx,body);
    if(body.action==='private_preview'&&ctx.capabilities.phase==='A')demand((body.hours??24)<=ctx.capabilities.limits.previewHours,'Preview duration exceeds A allowance',400);
    if(body.action==='start_github_build')demand(store.state.connections[p.id+':github:preview']?.status==='connected','Connect GitHub before preparing a build',409);
    if(body.action==='publish_cloudflare')demand(store.state.connections[p.id+':cloudflare:production']?.status==='connected','Connect customer Cloudflare production first',409);
    if(body.action==='publish_chain')demand(/^\d+$/.test(p.chain.cpuIndex||'')&&/^\d+$/.test(p.chain.tokenId||''),'Configure the chain CPU and NFT target first',409);
    if(body.action==='publish_chain'&&r.plan&&(r.plan.completed?.length||r.plan.pending||r.plan.signing))demand(r.plan.from?.toLowerCase()===body.wallet.toLowerCase(),'Existing plan wallet differs; reconcile the existing plan first',409);
    if(r)demand(body.expectedManifestHash===r.manifestHash,'Manifest changed',409);
    if(job)demand(['built','imported'].includes(job.status),'Build must finish before import',409);
    const requestDigest=digest(body),prior=Object.values(store.state.agentActions||{}).find(q=>q.actorId===ctx.actorId&&q.requestId===body.requestId);
    if(prior){demand(prior.requestDigest===requestDigest,'Request ID parameter conflict',409);return publicAgentAction(prior);}
    await ctx.admit();pruneRegistry(store);
    const ready=r?readiness(store,r):null;
    const q={id:id('op'),actorId:ctx.actorId,ownerId:ctx.ownerId,projectId:p.id,input:body,requestId:body.requestId,requestDigest,binding:current,status:'needs_user_action',createdAt:now(),expiresAt:Date.now()+10*60000,reviewNonce:randomBytes(24).toString('hex'),
      summary:{action:body.action,untrusted:{project:short(p.name),release:short(r?.label)},releaseId:r?.id||null,manifestHash:r?.manifestHash||null,files:r?.files.length||0,bytes:r?.bytes||0,chainId:p.chain.chainId,cpuIndex:p.chain.cpuIndex,tokenId:p.chain.tokenId,wallet:body.wallet||null,maximumNative:body.maximumNative||null,nativeSymbol:CHAINS[p.chain.chainId].nativeSymbol,hours:body.hours??(body.action==='private_preview'?24:null),compatibility:ready?.compatibility.status||null,legacy:!!ready?.legacy,restoreConfigurationChanged:!!ready?.restoreConfigurationChanged,public:body.action.startsWith('publish'),providerCost:body.action==='start_github_build'||body.action==='publish_cloudflare',expectedCommit:job?.commit||null}};
    if(body.action==='private_preview')q.summary.previewWillRotate=r.privatePreview?.status==='active';
    registry(store)[q.id]=q;store.save();return publicAgentAction(q);
  }
  match=path.match(/^\/api\/agent\/actions\/(op-[a-f0-9]{12})(?:\/(review|approve|execute|cancel|advance|complete-cloudflare))?$/);
  if(match){
    const q=lookup(ctx,match[1]),verb=match[2]||'status';
    await ctx.guard(q.input.releaseId?target('GET','/api/releases/'+q.input.releaseId+'/readiness'):target('GET','/api/projects/'+q.projectId+'/diagnostics'));
    if(method==='GET'&&verb==='status')return publicAgentAction(q);
    if(method==='GET'&&verb==='review'){
      await ensureCurrent(ctx,q);const r=q.input.releaseId?store.release(q.input.releaseId):null,ready=r?readiness(store,r):null;
      const details=ready?{files:r.files.map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256})),fileChanges:ready.fileChanges,configuration:ready.configuration,compatibility:ready.compatibility}:q.input.action==='start_github_build'?{build:{rootDirectory:'.',outputDirectory:'dist',buildCommand:'npm run build',ref:q.input.ref||'repository default branch'},note:'Exact source commit is recorded when the build is dispatched. Review the resulting artifact separately before publication.'}:null;
      return {...publicAgentAction(q),reviewNonce:q.reviewNonce,binding:q.binding,reviewDetails:ctx.actorId===ctx.ownerId?details:memberResponse(details)};
    }
    demand(method==='POST','Unknown agent route',404);
    if(verb==='cancel'){
      strictObject(body,[]);await ctx.guard(actionTarget(store,q.input));demand(!q.dispatchedAt,'Dispatched work must be reconciled; cancellation cannot undo it',409);
      q.status='cancelled';delete q.reviewNonce;store.save();return publicAgentAction(q);
    }
    if(verb==='approve'){
      strictObject(body,['reviewNonce','binding','confirm','acknowledgeUnknown','acknowledgeVariableL1','acknowledgeProviderCost'],['reviewNonce','binding','confirm']);
      await ensureCurrent(ctx,q);demand(!q.dispatchedAt,'Operation already dispatched',409);
      demand(body.confirm===true&&body.reviewNonce===q.reviewNonce&&body.binding===q.binding,'Review confirmation mismatch',409);
      if(q.summary.providerCost)demand(body.acknowledgeProviderCost===true,'Confirm customer provider costs',409);
      if(['publish_chain','publish_cloudflare','restore'].includes(q.input.action)){
        const r=store.release(q.input.releaseId),ready=readiness(store,r);
        demand(ready.compatibility.status!=='incompatible','Database incompatibility blocks this action',409);
        if(ready.compatibility.status==='unknown'||ready.legacy||ready.restoreConfigurationChanged)demand(body.acknowledgeUnknown===true,'Review unknown compatibility',409);
        if(q.input.action!=='restore')approveRelease(store,r,{digest:ready.digest,intent:q.input.action==='publish_chain'?'chain':'cloud',maxBudgetNative:q.input.maximumNative,acknowledgeUnknown:body.acknowledgeUnknown,acknowledgeLegacy:body.acknowledgeUnknown,acknowledgeRestore:body.acknowledgeUnknown,acknowledgeVariableL1:body.acknowledgeVariableL1});
        else q.restoreInput={digest:restoreCheck(store,r).digest,acknowledgeUnknown:body.acknowledgeUnknown===true};
      }
      await ctx.admit();q.binding=await binding(ctx,q.input);q.approvedAt=now();q.approvedDigest=q.binding;q.status='approved';delete q.reviewNonce;store.save();return publicAgentAction(q);
    }
    if(verb==='complete-cloudflare'){
      strictObject(body,['deploymentId','checkId','failedPaths'],['deploymentId','checkId','failedPaths']);await ensureCurrent(ctx,q,{approval:true});
      demand(q.input.action==='publish_cloudflare'&&q.dispatchedAt,'Cloudflare operation required',409);
      const result=await ctx.call(target('POST','/api/releases/'+q.input.releaseId+'/cloudflare/access',{...body,production:true}));
      q.status=result.status<400?'verified':'needs_user_action';q.result={stage:'publish_cloudflare',release:safeRelease(store,store.release(q.input.releaseId)),...(result.status>=400?{code:safeErrorCode(result.status)}:{})};store.save();return publicAgentAction(q);
    }
    strictObject(body,[]);
    // Reconciliation of an existing broadcast is safe even after approval
    // expiry; a different/new plan or new signature still requires new review.
    const pending=verb==='advance'&&q.input.action==='publish_chain'&&q.planId&&store.release(q.input.releaseId).plan?.id===q.planId&&store.release(q.input.releaseId).plan?.pending;
    if(pending)await ctx.guard(target('POST','/api/releases/'+q.input.releaseId+'/chain/confirm',{index:pending.index,hash:pending.hash}));
    else await ensureCurrent(ctx,q,{approval:true});
    if(verb==='advance'){
      if(q.input.action==='publish_cloudflare'){
        demand(q.dispatchedAt,'A dispatched Cloudflare operation is required',409);
        const r=store.release(q.input.releaseId),result=await ctx.call(target('POST','/api/releases/'+r.id+'/cloudflare/verify',{production:true}));
        if(result.status>=400)return {...publicAgentAction(q),status:'blocked',code:safeErrorCode(result.status)};
        if(result.data.status==='pending-browser-verification')return {...publicAgentAction(q),status:'running',uiVerification:{hostname:result.data.projectName+'.pages.dev',deploymentId:result.data.deploymentId,checkId:result.data.browserCheckId,files:r.files.map(({base64,...f})=>f),removed:result.data.verification?.removedPaths||[]}};
        return {...publicAgentAction(q),status:result.data.status==='success'?'verified':'needs_user_action',release:safeRelease(store,r)};
      }
      demand(q.input.action==='publish_chain'&&q.dispatchedAt,'A dispatched chain operation is required',409);
      const r=store.release(q.input.releaseId),plan=r.plan;demand(plan,'Plan unavailable',409);
      let next;
      if(plan.pending)next=target('POST','/api/releases/'+r.id+'/chain/confirm',{index:plan.pending.index,hash:plan.pending.hash});
      else if(plan.signing)return {...publicAgentAction(q),status:'needs_user_action',next:'reconcile_wallet_submission'};
      else if(plan.completed.length<plan.steps.length)return {...publicAgentAction(q),status:'needs_user_action',next:'wallet_step'};
      else if(r.chainStatus!=='verified')next=target('POST','/api/releases/'+r.id+'/chain/readback');
      if(next){const result=await ctx.call(next);if(result.status>=400)return {...publicAgentAction(q),status:'blocked',code:safeErrorCode(result.status)};}
      return {...publicAgentAction(q),status:publicationStatus(store,r).status==='complete'?'verified':'needs_user_action',release:safeRelease(store,r),next:'inspect_release_or_complete_native_access'};
    }
    demand(verb==='execute','Unknown agent action',404);
    if(q.result)return {...publicAgentAction(q),replayed:true};
    demand(!q.dispatchedAt,'Operation may have run; inspect state before retrying',409);
    await ctx.admit();q.dispatchedAt=now();q.status='running';store.save();await ctx.commit();
    const action=actionTarget(store,q.input);if(q.input.action==='restore')action.body={releaseId:q.input.releaseId,...q.restoreInput};
    const result=await ctx.call(action,{admitted:true});
    if(q.input.action==='publish_chain'&&result.status<400)q.planId=store.release(q.input.releaseId).plan?.id;
    const successful=result.status<400;
    if(successful&&['private_preview','revoke_preview'].includes(q.input.action)){q.binding=await binding(ctx,q.input);q.approvedDigest=q.binding;}
    q.status=successful?(['publish_chain','publish_cloudflare'].includes(q.input.action)?'needs_user_action':q.input.action==='start_github_build'?'queued':'verified'):'failed';
    const related=result.data?.id&&RID.test(result.data.id)?result.data:undefined;
    q.result=successful?{stage:q.input.action,...(related?{release:safeRelease(store,store.release(related.id))}:{}),...(q.input.action==='private_preview'?{preview:{url:result.data.url,expiresAt:result.data.expiresAt,status:result.data.status},userHandoff:'preview_credentials_shown_in_page'}:{}),...(q.input.action==='start_github_build'?{build:safeJob(result.data)}:{}),...(q.input.action==='publish_cloudflare'?{publicationStatus:result.data.status}:{}),...(q.input.releaseId&&q.input.action!=='restore'?{release:safeRelease(store,store.release(q.input.releaseId))}:{})}:{code:safeErrorCode(result.status)};
    q.finishedAt=now();store.save();
    // This field goes only to the first-party UI adapter, which must strip it
    // before returning a native tool result. It is never persisted or replayed.
    return {...publicAgentAction(q),...(successful&&q.input.action==='private_preview'?{uiSecret:{password:result.data.password,releaseId:q.input.releaseId}}:{})};
  }
  if(method==='POST'&&['/api/agent/create-project','/api/agent/sample'].includes(path)){
    const create=path.endsWith('create-project');strictObject(body,create?['name','description','requestId']:['projectId','version','requestId'],create?['name','requestId']:['projectId','version','requestId']);keyCheck(body.requestId);
    if(create)demand(typeof body.name==='string'&&body.name.length>=2&&body.name.length<=60&&(!body.description||typeof body.description==='string'&&body.description.length<=200),'Invalid project name',400);
    else demand(PID.test(body.projectId||'')&&[1,2].includes(body.version),'Invalid sample',400);
    const action=create?target('POST','/api/projects',{name:body.name,description:body.description||''}):target('POST','/api/projects/'+body.projectId+'/sample',{version:body.version});await ctx.guard(action);
    store.state.agentRequests||={};const key=digest({actor:ctx.actorId,requestId:body.requestId}),hash=digest({path,body}),old=store.state.agentRequests[key];
    if(old){demand(old.digest===hash,'Request ID parameter conflict',409);demand(old.result,'Operation may have run; inspect projects before retrying',409);return {...old.result,replayed:true};}
    for(const [key,row]of Object.entries(store.state.agentRequests))if(row.at<Date.now()-7*86400000)delete store.state.agentRequests[key];
    demand(Object.keys(store.state.agentRequests).length<1000,'Agent request allowance reached',429);
    await ctx.admit();store.state.agentRequests[key]={digest:hash,at:Date.now()};store.save();await ctx.commit();
    const result=await ctx.call(action,{admitted:true});demand(result.status<400,'Creation incomplete; inspect operation state',result.status);
    const output=create?{status:'verified',stage:'project_created',projectId:result.data.id,untrusted:{name:short(result.data.name)}}:{status:'verified',stage:'sample_archived',release:safeRelease(store,store.release(result.data.id))};
    store.state.agentRequests[key].result=output;store.save();return output;
  }
  demand(false,'Unknown agent route',404);
}
