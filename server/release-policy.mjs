import {chainFor,nativeName} from './chains.mjs';
import { createHash } from 'node:crypto';

const check = (ok, message) => { if (!ok) throw Object.assign(new Error(message), {status:409}); };
export const canonical = value => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,normalize(value[k])]));
  return value;
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export function configurationSnapshot(store, pid) {
  const p=store.project(pid);
  return {
    schema:1,
    environment:(p.environment||[]).map(e=>({key:e.key,environment:e.environment,stage:e.stage||'build',secret:e.secret,
      ...(e.secret?{reference:e.id}:{value:e.value})})).sort((a,b)=>(a.environment+a.key).localeCompare(b.environment+b.key)),
    connections:Object.entries(store.state.connections).filter(([,c])=>c.projectId===pid&&c.provider!=='secret').map(([key,c])=>({
      key,provider:c.provider,environment:c.environment||'preview',status:c.status,label:c.label||'',grantId:c.grantId||null,
      reference:digest(c.secrets||{})
    })).sort((a,b)=>a.key.localeCompare(b.key)),
    chain:{chainId:p.chain.chainId,cpuIndex:p.chain.cpuIndex,tokenId:p.chain.tokenId},
    domains:store.state.domains.filter(d=>d.projectId===pid).map(d=>({hostname:d.hostname})).sort((a,b)=>a.hostname.localeCompare(b.hostname)),
    databaseVersion:p.databaseVersion||null
  };
}
export function buildDigest(configuration, source) {
  return digest({environment:configuration.environment.filter(e=>e.stage==='build'),
    // Sample artifacts embed the selected preview database's public URL/key.
    sampleDatabase:source?.type==='sample'?configuration.connections.filter(c=>c.provider==='supabase'&&c.environment===(source?.dataEnvironment||'preview')):[]});
}
export function compatibility(store,r) {
  const current=store.project(r.projectId).databaseVersion||null, contract=r.databaseContract;
  if(contract?.usesDatabase===false)return {status:'compatible',reason:'此版本声明不使用数据库',current};
  if(current && contract?.versions?.length) return {status:contract.versions.includes(current)?'compatible':'incompatible',reason:contract.versions.includes(current)?'已声明兼容当前数据结构':'当前数据库版本不在此版本的兼容列表中',current,versions:contract.versions};
  return {status:'unknown',reason:'尚未声明数据库兼容关系；TapeNow 不会修改或还原业务数据库',current,versions:contract?.versions||[]};
}
export function validateContract(value) {
  check(value && typeof value.usesDatabase==='boolean','请选择数据库使用情况');
  const versions=value.usesDatabase ? value.versions||[] : [];
  check(Array.isArray(versions)&&versions.length<=30&&versions.every(v=>typeof v==='string'&&/^[a-zA-Z0-9._-]{1,64}$/.test(v)),'数据结构版本格式无效');
  return {usesDatabase:value.usesDatabase,versions:[...new Set(versions)].sort()};
}
export function approvalDigest(store,r) {
  return digest({releaseId:r.id,manifestHash:r.manifestHash,artifactConfiguration:r.configuration||null,
    configuration:configurationSnapshot(store,r.projectId),...(r.dependencyDeclarations?.length?{dependencyDeclarations:r.dependencyDeclarations}:{}),databaseContract:r.databaseContract||null,restoredFrom:r.restoredFrom||null});
}
export function readiness(store,r) {
  const configuration=configurationSnapshot(store,r.projectId),p=store.project(r.projectId),previous=store.state.releases.find(x=>x.id===(p.siteProductionId||p.cloudflareProductionId||p.productionId));
  const snapshot=approvalDigest(store,r), compat=compatibility(store,r);
  const buildChanged=Boolean(r.configuration && r.buildDigest!==buildDigest(configuration,r.source) && !r.restoredFrom);
  const approved=Boolean(r.approval?.digest===snapshot && compat.status!=='incompatible' && !buildChanged);
  return {digest:snapshot,approved,approval:r.approval||null,legacy:!r.configuration,buildChanged,compatibility:compat,
    configuration,artifactConfiguration:r.configuration||null,previousConfiguration:previous?.configuration||null,
    fileChanges:{added:r.files.filter(f=>!previous?.files.some(p=>p.path===f.path)).map(f=>f.path),removed:(previous?.files||[]).filter(f=>!r.files.some(p=>p.path===f.path)).map(f=>f.path),modified:r.files.filter(f=>previous?.files.some(p=>p.path===f.path&&p.sha256!==f.sha256)).map(f=>f.path)},
    changes:!previous?'首次发布':previous.manifestHash!==r.manifestHash?'文件已变化':digest(previous.configuration||null)!==digest(configuration)?'配置已变化':'文件与记录的配置相同',
    restoreConfigurationChanged:Boolean(r.restoredFrom&&digest(r.configuration||null)!==digest(configuration))};
}
export function approveRelease(store,r,input) {
  check(!r.plan?.pending&&!r.plan?.signing,'先恢复待确认的交易，再修改发布批准');
  const ready=readiness(store,r);
  check(input.digest===ready.digest,'文件或配置已变化，请重新检查确认');
  check(!ready.buildChanged,'构建期配置已变化；请重新构建并导入新版本');
  check(ready.compatibility.status!=='incompatible','数据结构已知不兼容，停止发布');
  check(ready.compatibility.status!=='unknown'||input.acknowledgeUnknown===true,'请明确确认未知的数据库兼容性');
  check(!ready.legacy||input.acknowledgeLegacy===true,'历史版本缺少构建快照；请先核对原产物与当前配置');
  check(!ready.restoreConfigurationChanged||input.acknowledgeRestore===true,'请确认恢复旧产物，同时沿用当前连接和秘密引用');
  check(['cloud','chain'].includes(input.intent),'发布目标无效');
  if(input.intent==='chain') {
    const chain=chainFor(ready.configuration.chain.chainId);
    const cap=parseOKB(input.maxBudgetNative ?? (chain.chainId===196?input.maxBudgetOKB:undefined));
    check(!r.plan||Number(r.plan.chainId??196)===chain.chainId,'已有交易计划属于另一条链，请新建发布版本');
    check(cap>0n,'请填写本次发布的原生代币总上限');
    const costs=budgetSummary(r);
    check(!costs.unknown,'存在无法核定的费用；请先完成费用核验');
    check(cap>=BigInt(costs.spentWei),'预算不能低于已支付金额');
    check(chain.chainId!==8453||input.acknowledgeVariableL1===true,'请确认 Base 数据费随上链时价格变化，预算是带缓冲的估算而非链上绝对封顶');
    r.budget={chainId:chain.chainId,nativeSymbol:chain.nativeSymbol,capWei:String(cap),updatedAt:new Date().toISOString(),...(chain.chainId===8453?{acknowledgeVariableL1:true}:{})};
  }
  if(!r.configuration) {
    // An explicit attestation, not a claim that a historical build was rerun.
    r.configuration=configurationSnapshot(store,r.projectId);
    r.buildDigest=buildDigest(r.configuration,r.source);
    r.configurationAttestedAt=new Date().toISOString();
  }
  r.approval={digest:approvalDigest(store,r),intent:input.intent,approvedAt:new Date().toISOString(),
    acknowledgeUnknown:input.acknowledgeUnknown===true,acknowledgeRestore:input.acknowledgeRestore===true};
  r.approvedConfiguration=configurationSnapshot(store,r.projectId);
  r.receipt=store.receiptFor(r,"release-approval");
  if(r.plan){
    delete r.plan.quote;
    const target=store.project(r.projectId).chain;
    if(!r.plan.targetDigest&&r.plan.manifestHash===r.manifestHash&&r.plan.chainId===target.chainId&&r.plan.tokenId===target.tokenId&&r.plan.name===nativeName(target))
      r.plan.targetDigest=digest({chainId:target.chainId,cpuIndex:target.cpuIndex,tokenId:target.tokenId});
  }
  store.save();store.log(r.projectId,'发布文件、配置与目标已确认','success',r.id);
  return readiness(store,r);
}
export function assertApproved(store,r,intent) {
  check((r.archive?.state||'available')==='available','请先从回收站恢复归档');
  check(!['preparing','active'].includes(r.privatePreview?.status),'请先撤销私有预览，再明确公开发布');
  const ready=readiness(store,r);
  check(ready.approved,'发布确认缺失或已失效；请重新检查文件、配置与目标');
  check(!intent||r.approval.intent===intent,'请确认本次发布的目标类型');
  return ready;
}
export function restoreCheck(store,r) {
  const ready=readiness(store,r);
  return {digest:ready.digest,compatibility:ready.compatibility,legacy:ready.legacy,
    allowed:ready.compatibility.status!=='incompatible',requiresAcknowledgment:ready.compatibility.status==='unknown'||ready.legacy,
    configuration:r.configuration||null,currentConfiguration:ready.configuration};
}
export function assertRestore(store,r,input={}) {
  const result=restoreCheck(store,r);
  check(input.digest===result.digest,'恢复检查已过期，请重新检查');
  check(result.allowed,'当前数据库与该版本不兼容，无法恢复');
  check(!result.requiresAcknowledgment||input.acknowledgeUnknown===true,'请明确确认未知的历史配置或数据库兼容性');
}
export function parseOKB(value) {
  check(typeof value==='string'&&/^(?:0|[1-9]\d{0,9})(?:\.\d{1,18})?$/.test(value),'金额格式无效（最多 18 位小数）');
  const [whole,fraction='']=value.split('.');return BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'));
}
export function formatOKB(value) {
  const n=BigInt(value), sign=n<0n?'-':'', v=n<0n?-n:n;
  return sign+String(v/10n**18n)+'.'+String(v%10n**18n).padStart(18,'0').replace(/0+$/,'').padEnd(1,'0');
}
export function budgetSummary(r) {
  const expenses=r.expenses||[];
  const recorded=new Set(expenses.map(e=>e.hash.toLowerCase()));
  const unknown=expenses.some(e=>e.totalWei==null)||(r.transactions||[]).some(e=>!recorded.has(e.hash.toLowerCase()))||(r.failedTransactions||[]).some(e=>!recorded.has(e.hash.toLowerCase()));
  const spent=expenses.reduce((n,e)=>n+BigInt(e.totalWei||0),0n),cap=r.budget?.capWei;
  const chain=chainFor(r.plan?.chainId??r.budget?.chainId??r.approvedConfiguration?.chain?.chainId??r.configuration?.chain?.chainId??196);
  const values={spentNative:formatOKB(spent),capNative:cap?formatOKB(cap):null,remainingNative:cap?formatOKB(BigInt(cap)-spent):null};
  return {chainId:chain.chainId,nativeSymbol:chain.nativeSymbol,spentWei:String(spent),...values,...(chain.chainId===196?{spentOKB:values.spentNative,capOKB:values.capNative,remainingOKB:values.remainingNative}:{}),unknown,expenses};
}
export function checkBudget(r,amount) {
  const summary=budgetSummary(r);
  check(!summary.unknown,'存在无法核定的历史费用，停止新签署');
  check(r.budget?.capWei,'请先确认整次发布的总预算');
  check(Number(r.budget.chainId??196)===Number(r.plan?.chainId??r.approvedConfiguration?.chain?.chainId??196),'预算与发布网络不匹配，请重新确认');
  check(BigInt(summary.spentWei)+BigInt(amount)<=BigInt(r.budget.capWei),'剩余预算不足，已停止新签署；可以核对费用后调整总上限');
}
export function recordExpense(r,{hash,gasWei,valueWei,success,kind,block,feeBreakdown}) {
  r.expenses||=[];
  const existing=r.expenses.findIndex(e=>e.hash.toLowerCase()===hash.toLowerCase());
  if(existing>=0){if(r.expenses[existing].totalWei!=null||gasWei==null)return;r.expenses.splice(existing,1);}
  const total=gasWei==null?null:String(BigInt(gasWei)+(success?BigInt(valueWei):0n));
  r.expenses.push({hash,gasWei:gasWei==null?null:String(gasWei),valueWei:success?String(valueWei):'0',totalWei:total,success,kind,block,...(feeBreakdown?{feeBreakdown}:{})});
}
export function publicationStatus(store,r) {
  const p=store.project(r.projectId), ready=readiness(store,r);
  const steps=[{key:'artifact',label:'产物归档',status:'complete'},
    {key:'approval',label:'发布确认',status:ready.approved?'complete':'required'}];
  const chain=r.approval?r.approval.intent==='chain':!!r.plan;
  let next=ready.buildChanged?'重新构建并导入新产物':'检查配置并确认发布';
  let status='needs_approval';
  if(ready.approved){status='ready';next=chain?'生成或继续链上发布计划':'发布普通访问入口';}
  if(chain) {
    const pending=!!(r.plan?.pending||r.plan?.signing), written=Boolean(r.plan&&r.plan.completed.length===r.plan.steps.length);
    const laterWriter=store.state.releases.some(x=>x.id!==r.id&&x.projectId===r.projectId&&(x.plan?.chainId??196)===(r.plan?.chainId??196)&&x.plan?.container===r.plan?.container&&((x.verification?.verifiedAt||'')>(r.verification?.verifiedAt||'')||x.chainStatus==='publishing'));
    const verified=r.chainStatus==='verified'&&!!r.verification&&!laterWriter;
    const live=r.activation?.live===true&&Number(r.activation.paidUntil)*1000>Date.now();
    steps.push({key:'write',label:'链上写入',status:pending?'pending':written?'complete':r.plan?.completed.length?'partial':'required'},
      {key:'readback',label:'文件读回核验',status:verified?'complete':'required'},
      {key:'native',label:'原生入口有效期',status:live?'complete':'required'});
    if(pending){status='pending';next='恢复待确认交易；不要重复签署';}
    else if(ready.approved){status='in_progress';next=!r.plan?'生成发布计划':!written?'核对报价并签署下一步':!verified?'读回核验所有文件':!live?'检查或激活原生入口':'打开原生网址并检查版本与交互';}
  }
  const siteCurrent=p.siteProductionId===r.id&&r.site?.status==='published';
  const cfCurrent=p.cloudflareProductionId===r.id&&r.cloudflareProduction?.status==='success';
  const gatewayCurrent=p.gateway?.releaseId===r.id&&p.gateway.status==='active'&&p.gateway.leaseUntil>Date.now()&&p.gateway.paidUntil>Date.now();
  const nativeCurrent=chain&&p.nativeProductionId===r.id&&r.nativeAccess?.status==='observed'&&r.nativeAccess.binding===digest({releaseId:r.id,manifestHash:r.manifestHash,target:p.chain,verification:r.verification,approval:r.approval?.digest});
  const hashportCurrent=chain&&store.state.domains.some(d=>d.projectId===p.id&&d.provider==='hashport'&&d.status==='active'&&d.verification?.manifestHash===r.manifestHash&&d.verification?.https?.verified===true);
  const access=siteCurrent||cfCurrent||gatewayCurrent||nativeCurrent||hashportCurrent;
  steps.push({key:'access',label:chain?'实际访问确认':'普通访问入口',status:access?'complete':p.siteProductionId===r.id||p.cloudflarePendingId===r.id?'pending':r.site||r.cloudflareProduction||r.gateway||r.nativeAccess?'superseded':'required'});
  if(ready.approved&&steps.every(s=>s.status==='complete')){status='complete';next=r.restoredFrom?'恢复已发布；业务数据库未修改':'发布已完成';}
  return {status,next,steps,restoredFrom:r.restoredFrom||null,intent:chain?'chain':'cloud'};
}
