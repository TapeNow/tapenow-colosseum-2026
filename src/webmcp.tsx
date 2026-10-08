import React,{useEffect,useRef,useState} from 'react';
import {agentApi,api,captureAgentScope,assertAgentScope,setWorkspace,getSession,bytes,file64,type AgentScope} from './api';
import {setLanguage,t,useLanguage,translateMessage,localeDate} from './i18n';
import {Modal,Notice,Badge} from './ui';
// @ts-ignore Existing first-party visitor verification, shared with the UI.
import {verifyPagesManifest} from '../shared/pages-readback.mjs';
// @ts-ignore Shared schema/validation is also tested directly in Node.
import {WEBMCP_TOOLS,validateToolInput,toolSafeResult} from '../shared/webmcp-tools.mjs';
type Handoff={kind:string;projectId?:string;releaseId?:string;provider?:string;environment?:string};
type NativeContext={registerTool:(tool:any,options:{signal:AbortSignal})=>Promise<void>;getTools:()=>Promise<any[]>};
const errorResult=(e:any)=>({status:'blocked',code:({400:'invalid_arguments',401:'sign_in_required',403:'permission_denied',404:'resource_unavailable',409:'review_or_reconciliation_required',423:'project_suspended',429:'quota_reached'} as any)[e.httpStatus]||(String(e.message)==='invalid_arguments'?'invalid_arguments':'operation_incomplete'),next:'inspect_status_or_use_user_interface'});
const context=()=> (document as Document&{modelContext?:NativeContext}).modelContext;
export function WebMCPBridge({routeKey,onChanged,currentRole,sharedPublisher=false,currentWallet=''}:{routeKey:string;onChanged:()=>Promise<void>;currentRole?:string;sharedPublisher?:boolean;currentWallet?:string}){
 const {language}=useLanguage(),scope=captureAgentScope(),scopeKey=scope?scope.actorId+':'+scope.ownerId:'';
 const [state,setState]=useState<'checking'|'unsupported'|'available'|'failed'>('checking'),[count,setCount]=useState(0),[review,setReview]=useState<any>(null),[secret,setSecret]=useState<{password:string;releaseId:string}|null>(null),[handoff,setHandoff]=useState<Handoff|null>(null),[handoffStatus,setHandoffStatus]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ack,setAck]=useState(false),[providerCost,setProviderCost]=useState(false),[baseFee,setBaseFee]=useState(false);
 const refreshRef=useRef(onChanged);refreshRef.current=onChanged;const walletRef=useRef(currentWallet);walletRef.current=currentWallet;
 const controllerRef=useRef<AbortController|null>(null),handoffRef=useRef<any>(null),pickerRef=useRef<HTMLInputElement>(null),transitionRef=useRef(false);
 handoffRef.current=handoffStatus;
 async function openReview(operationId:string,captured:AgentScope){
   try{const value=await agentApi(captured,'/agent/actions/'+operationId+'/review');setReview(value);setAck(false);setProviderCost(false);setBaseFee(false);setError('');}catch(e){setError((e as Error).message);}
 }
 useEffect(()=>{
   setReview(null);setSecret(null);setHandoff(null);setHandoffStatus(null);setError('');setCount(0);transitionRef.current=false;
   if(!scope)return;
   const captured=scope,m=context(),controller=new AbortController();controllerRef.current=controller;
   const invalidate=()=>controller.abort();window.addEventListener('tapenow-signed-out',invalidate);window.addEventListener('tapenow-workspace-changed',invalidate);
   if(!m?.registerTool){setState('unsupported');return()=>{controller.abort();window.removeEventListener('tapenow-signed-out',invalidate);window.removeEventListener('tapenow-workspace-changed',invalidate);};}
   setState('checking');let active=true;
   const ensure=()=>{if(controller.signal.aborted||transitionRef.current)throw Object.assign(Error('Agent context changed'),{httpStatus:409});assertAgentScope(captured);};
   const call=async(path:string,body?:unknown)=>{ensure();const result=await agentApi(captured,path,body);ensure();return result;};
   async function execute(name:string,input:any){
     ensure();let result:any;
     switch(name){
       case 'context':return {...await call('/agent/context'),nativeWebMCP:true,handoff:handoffRef.current,wallet:{connected:!!walletRef.current,address:walletRef.current||null}};
       case 'list_workspaces':{const data=await agentApi(captured,'/workspaces');return {status:'verified',current:captured.ownerId,workspaces:[{workspaceId:captured.actorId,kind:'own'},...Array.from(new Set<string>((data.items||[]).map((r:any)=>r.owner_id))).map(workspaceId=>({workspaceId,kind:'shared'}))]};}
       case 'select_workspace':{const data=await agentApi(captured,'/workspaces');if(input.workspaceId!==captured.actorId&&!data.items.some((r:any)=>r.owner_id===input.workspaceId))throw Object.assign(Error('Workspace unavailable'),{httpStatus:403});transitionRef.current=true;setTimeout(()=>{setWorkspace(input.workspaceId===captured.actorId?'':input.workspaceId);window.location.hash='/';void refreshRef.current();},50);return {status:'needs_user_action',next:'rediscover_tools_after_workspace_change'};}
       case 'inspect_project':return call('/agent/projects/'+input.projectId+'?offset='+(input.offset||0));
       case 'inspect_release':return call('/agent/releases/'+input.releaseId+'?offset='+(input.offset||0));
       case 'build_status':return call('/agent/jobs/'+input.jobId);
       case 'poll_build':result=await call('/agent/jobs/'+input.jobId+'/poll',{});break;
       case 'create_project':result=await call('/agent/create-project',input);break;
       case 'create_sample':result=await call('/agent/sample',input);break;
       case 'prepare_action':result=await call('/agent/prepare',input);if(result.status==='needs_user_action'&&!result.result)void openReview(result.operationId,captured);break;
       case 'action_status':return call('/agent/actions/'+input.operationId);
       case 'cancel_action':result=await call('/agent/actions/'+input.operationId+'/cancel',{});setReview(null);break;
       case 'execute_action':result=await call('/agent/actions/'+input.operationId+'/execute',{});if(result.uiSecret){setSecret(result.uiSecret);delete result.uiSecret;}break;
       case 'advance_publication':{
         result=await call('/agent/actions/'+input.operationId+'/advance',{});
         if(result.uiVerification){const v=result.uiVerification;if(!/^tn-p-[a-f0-9]{12}\.pages\.dev$/.test(v.hostname))throw Error('invalid_arguments');const proof=await verifyPagesManifest('https://'+v.hostname,{files:v.files,removed:v.removed});ensure();result=await call('/agent/actions/'+input.operationId+'/complete-cloudflare',{deploymentId:v.deploymentId,checkId:v.checkId,failedPaths:proof.failed.map((f:any)=>f.path)});}
         break;
       }
       case 'set_language':setLanguage(input.language);return {status:'verified',language:input.language};
       case 'open_handoff':{
         if(input.kind!=='guide'){
           if(!input.projectId)throw Error('invalid_arguments');const project=await call('/agent/projects/'+input.projectId);
           if(['provider','data','domains','settings','export'].includes(input.kind)&&project.role!=='owner'||['files','wallet','native_access'].includes(input.kind)&&project.role==='viewer')throw Object.assign(Error('Permission denied'),{httpStatus:403});
           if(input.releaseId){const r=await call('/agent/releases/'+input.releaseId);if(r.projectId!==project.projectId)throw Error('invalid_arguments');}
           if(['wallet','native_access','export'].includes(input.kind)&&!input.releaseId)throw Error('invalid_arguments');
         }
         setHandoff(input);setHandoffStatus({status:'needs_user_action',kind:input.kind,projectId:input.projectId||null});
         return {status:'needs_user_action',kind:input.kind,next:'complete_the_visible_user_handoff'};
       }
       default:throw Error('invalid_arguments');
     }
     void refreshRef.current();return result;
   }
   void(async()=>{
     try{
       const canWrite=currentRole!=='viewer'&&(captured.actorId===captured.ownerId||sharedPublisher||currentRole==='publisher');
       const ownerOnly=new Set(['tapenow_create_project','tapenow_create_sample']);
       const mutations=new Set(['tapenow_create_project','tapenow_create_sample','tapenow_prepare_action','tapenow_execute_action','tapenow_cancel_action','tapenow_advance_publication','tapenow_poll_build']);
       const definitions=WEBMCP_TOOLS.filter((d:any)=>(canWrite||!mutations.has(d.name))&&(captured.actorId===captured.ownerId||!ownerOnly.has(d.name)));
       for(const definition of definitions){
         await m.registerTool({...definition,execute:async(input:any)=>{
           try{validateToolInput(definition.inputSchema,input);return toolSafeResult(await execute(definition.name.slice(8),input));}
           catch(e){return toolSafeResult(errorResult(e));}
         }},{signal:controller.signal});
       }
       if(active&&!controller.signal.aborted){setState('available');setCount(definitions.length);}
     }catch{controller.abort();if(active){setState('failed');setCount(0);}}
   })();
   return()=>{active=false;controller.abort();window.removeEventListener('tapenow-signed-out',invalidate);window.removeEventListener('tapenow-workspace-changed',invalidate);};
 },[scopeKey,routeKey,currentRole,sharedPublisher]);
 useEffect(()=>{const picker=pickerRef.current;if(!picker)return;const cancel=()=>setHandoffStatus({status:'cancelled',kind:'files'});picker.addEventListener('cancel',cancel);return()=>picker.removeEventListener('cancel',cancel);},[handoff]);
 const actionLabel=(action:string)=>({private_preview:t('创建私有预览'),restore:t('创建恢复候选'),publish_chain:t('准备链上发布'),publish_cloudflare:t('发布到自己的 Cloudflare'),verify_content:t('读回核验链上内容'),revoke_preview:t('撤销私有预览'),start_github_build:t('启动已配置的 GitHub 构建'),import_build:t('导入已完成构建')} as Record<string,string>)[action]||action;
 const needsCompatibility=review&&['publish_chain','publish_cloudflare','restore'].includes(review.action)&&(review.summary.compatibility==='unknown'||review.summary.legacy||review.summary.restoreConfigurationChanged);
 const requiresBase=review?.action==='publish_chain'&&review.summary.chainId===8453;
 async function approve(){if(!scope||!review)return;setBusy(true);setError('');try{await agentApi(scope,'/agent/actions/'+review.operationId+'/approve',{reviewNonce:review.reviewNonce,binding:review.binding,confirm:true,acknowledgeUnknown:ack,acknowledgeProviderCost:providerCost,acknowledgeVariableL1:baseFee});setReview(null);await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function closeReview(){if(scope&&review){try{await agentApi(scope,'/agent/actions/'+review.operationId+'/cancel',{});}catch{}}setReview(null);setError('');}
 function handoffPath(h:Handoff){const p=h.projectId,r=h.releaseId;if(h.kind==='guide')return '/docs/webmcp.html';if(r)return '#/'+p+'/deployments/'+r;return '#/'+p+'/'+(({provider:'integrations',data:'storage',domains:'domains',settings:'settings'} as Record<string,string>)[h.kind]||'deployments');}
 async function importFiles(files:FileList|null){
   if(!scope||!handoff?.projectId)return;if(!files?.length){setHandoffStatus({status:'cancelled',kind:'files'});return;}
   setBusy(true);setError('');const captured=scope;
   try{
     const items=Array.from(files);if(items.length>500||items.reduce((n,f)=>n+f.size,0)>10*1024*1024)throw Error(t('文件总量超过 10 MiB 或 500 个文件'));
     const body=items.length===1&&items[0].name.endsWith('.zip')?{zip:await file64(items[0]),label:items[0].name}:{files:await Promise.all(items.map(async file=>({path:file.webkitRelativePath||file.name,base64:await file64(file)}))),label:t('用户选择的构建文件')};
     const result=await agentApi(captured,'/projects/'+handoff.projectId+'/import',body);assertAgentScope(captured);setHandoffStatus({status:'verified',kind:'files',releaseId:result.id,projectId:result.projectId});setHandoff(null);await onChanged();
   }catch(e){setError((e as Error).message);setHandoffStatus({status:'failed',kind:'files'});}finally{setBusy(false);}
 }
 if(!scope)return null;
 return <>
 <div className="agent-status" role="status"><Badge tone={state==='available'?'teal':'neutral'}>WebMCP</Badge><span>{state==='available'?t('Agent 工具已就绪')+' · '+count:state==='unsupported'?t('此浏览器未启用原生 WebMCP，仍可正常使用界面'):state==='failed'?t('Agent 工具初始化未完成，请刷新重试'):t('正在准备 Agent 工具…')}</span><a href="/docs/webmcp.html" target="_blank" rel="noreferrer">{t('使用方法')}</a></div>
 {review&&<Modal title={t('确认 Agent 请求')} busy={busy} onClose={()=>void closeReview()}><div className="modal-form agent-review"><h3>{actionLabel(review.action)}</h3><p>{review.summary.untrusted.project} · {review.summary.untrusted.release}</p><code>{review.operationId}</code>{review.summary.manifestHash&&<><p>{review.summary.files} {t('个文件')} · {bytes(review.summary.bytes)}</p><code className="release-fingerprint">{review.summary.manifestHash}</code></>}
 <p>{t('批准有效期至')} {localeDate(review.expiresAt,{dateStyle:'short',timeStyle:'medium'})}</p>{review.summary.maximumNative&&<Notice>{t('预算上限')} {review.summary.maximumNative} {review.summary.nativeSymbol} · chain {review.summary.chainId} / CPU {review.summary.cpuIndex} / NFT {review.summary.tokenId}<p>{t('这里只允许代理准备发布；发送交易仍由钱包确认。')}</p></Notice>}
 {review.summary.wallet&&<p>{t('签署钱包')} <code className="release-fingerprint">{review.summary.wallet}</code></p>}
 {review.reviewDetails&&<details className="approval-diff"><summary>{t('核对文件、配置与差异')}</summary><pre className="agent-review-details">{JSON.stringify(review.reviewDetails,null,2)}</pre></details>}
 {review.summary.public&&<Notice>{t('这个操作会公开已确认的文件。请核对目标和版本。')}</Notice>}
 {review.action==='private_preview'&&<Notice>{t('创建有密码的限时预览；密码只在用户界面显示，不交给 Agent。')} {review.summary.hours} h</Notice>}
 {review.summary.previewWillRotate&&<Notice>{t('当前预览密码将被替换，旧密码立即失效。')}</Notice>}
 {needsCompatibility&&<label className="checkbox-label"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>{t('我已核对未知兼容性和历史配置；业务数据库不会自动回退。')}</label>}
 {requiresBase&&<label className="checkbox-label"><input type="checkbox" checked={baseFee} onChange={e=>setBaseFee(e.target.checked)}/>{t('我理解 Base 数据费随上链时变化，预算不是链上绝对封顶。')}</label>}
 {review.summary.providerCost&&<label className="checkbox-label"><input type="checkbox" checked={providerCost} onChange={e=>setProviderCost(e.target.checked)}/>{t('我同意使用自己已连接的供应商资源，并承担供应商用量费用。')}</label>}
 {error&&<p role="alert">{translateMessage(error)}</p>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={()=>void closeReview()}>{t('取消')}</button><button className="button primary" disabled={busy||review.expiresAt<=Date.now()||(needsCompatibility&&!ack)||(requiresBase&&!baseFee)||(review.summary.providerCost&&!providerCost)} onClick={e=>{if(e.nativeEvent.isTrusted)void approve();}}>{t('批准这项操作')}</button></div></div></Modal>}
 {secret&&<Modal title={t('请保存预览密码')} onClose={()=>setSecret(null)}><div className="modal-form"><Notice>{t('密码仅在这里显示，Agent 不会收到它。关闭后可以重新生成预览密码。')}</Notice><code className="release-fingerprint">{secret.password}</code><button className="button secondary" onClick={()=>setSecret(null)}>{t('已保存，关闭')}</button></div></Modal>}
 {handoff&&<Modal title={t('需要你完成这一步')} busy={busy} onClose={()=>{setHandoffStatus({status:'cancelled',kind:handoff.kind});setHandoff(null);}}><div className="modal-form"><p>{t('账号授权、文件选择、密码与钱包签署由你在安全界面完成。Agent 只能读取结果状态。')}</p>
 {handoff.kind==='files'?<label>{t('选择 ZIP 或构建文件，上传到私有归档')}<input ref={pickerRef} type="file" multiple disabled={busy} onChange={e=>void importFiles(e.target.files)}/></label>:handoff.kind==='export'?<a className="button primary" href={'/api/releases/'+handoff.releaseId+'/export'} target="_blank" rel="noreferrer">{t('下载签名导出包')}</a>:<a className="button primary" href={handoffPath(handoff)} onClick={()=>{setHandoffStatus({status:'needs_user_action',kind:handoff.kind,next:'continue_in_selected_panel'});setHandoff(null);}}>{t('前往对应界面')}</a>}
 {error&&<p role="alert">{translateMessage(error)}</p>}</div></Modal>}
 </>;
}
