import {chainFor,planChain} from './chains.mjs';
import {randomBytes} from 'node:crypto';
import {assertApproved,checkBudget,approvalDigest,digest,formatOKB} from './release-policy.mjs';
const check=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{status:409});};
export function assertPlanTarget(store,r) {
  const plan=r.plan, p=store.project(r.projectId);
  check(!store.state.releases.some(x=>x.id!==r.id&&x.projectId===r.projectId&&(x.plan?.pending||x.plan?.signing||x.chainStatus==='publishing')),'同项目另一个版本仍有待确认或部分完成的链上写入，请先恢复该版本');
  check(plan&&planChain(plan).chainId===chainFor(p.chain?.chainId??196).chainId,'链目标已变化；请恢复原链计划');
  check(!r.budget || planChain(plan).chainId===(r.budget.chainId??196),'预算网络与发布计划不匹配，请重新确认预算');
  check(plan&&plan.targetDigest===digest(p.chain?{chainId:p.chain.chainId,cpuIndex:p.chain.cpuIndex,tokenId:p.chain.tokenId}:null),'链目标已变化或历史计划缺少目标确认；请重新生成计划');
  check(plan.manifestHash===r.manifestHash,'计划与当前产物不匹配');
}
export function quoteStep(store,r,{gas,gasPrice,balance,walletCode='0x',l1FeeWei=null,operatorFeeWei=null,at=Date.now()}) {
  assertApproved(store,r,'chain');assertPlanTarget(store,r);
  const plan=r.plan,chain=planChain(plan),index=plan.completed.length,step=plan.steps[index];
  check(step&&!plan.pending&&!plan.signing,'请先恢复待确认步骤');
  // The browser wallet may convert a delegated account request into handleOps.
  // Its separate UserOperation/paymaster fee cap cannot be enforced by eth_sendTransaction.
  check(walletCode==='0x','此钱包启用了智能账户；当前无法约束其独立手续费上限。请使用普通账户发布，已有交易仍可恢复核验');
  check(gas>0n&&gasPrice>0n,'无法取得有效手续费报价');
  const gasLimit=gas*13n/10n+20000n,feeCap=gasPrice*12n/10n+1n;
  const base=chain.chainId===8453;
  check(!base||r.budget?.acknowledgeVariableL1===true,'请先确认 Base 数据费会随上链时价格变化');
  check(!base||(typeof l1FeeWei==='bigint'&&l1FeeWei>0n&&typeof operatorFeeWei==='bigint'&&operatorFeeWei>=0n),'Base 完整手续费报价不可用');
  const intrinsic=base?l1FeeWei+operatorFeeWei:0n,reserve=intrinsic*2n;
  const maximum=gasLimit*feeCap+BigInt(step.value)+reserve;
  const laterValue=plan.steps.slice(index+1).reduce((n,s)=>n+BigInt(s.value),0n)+BigInt(plan.activationReserveWei||0);
  checkBudget(r,maximum+laterValue);
  check(balance>=maximum+laterValue,'钱包余额不足以支付本步骤及已知后续固定费用');
  const hex=n=>'0x'+BigInt(n).toString(16);
  const quote={id:'q-'+randomBytes(12).toString('hex'),index,planId:plan.id,approvalDigest:approvalDigest(store,r),
    stepDigest:digest(step),expiresAt:at+(base?30000:60000),checkedAt:new Date(at).toISOString(),gas:String(gas),
    ...(base?{variableDataFee:true,l1FeeWei:String(l1FeeWei),operatorFeeWei:String(operatorFeeWei),intrinsicReserveWei:String(reserve),feeLimitKind:'buffered-estimate'}:{}),
    maximumWei:String(maximum),nativeSymbol:chain.nativeSymbol,chainId:chain.chainId,estimatedNative:formatOKB(gas*gasPrice+BigInt(step.value)+intrinsic),maximumNative:formatOKB(maximum),reservedFixedNative:formatOKB(laterValue),
    transaction:{chainId:hex(chain.chainId),from:plan.from,to:step.to,data:step.data,value:hex(step.value),gas:hex(gasLimit),gasPrice:hex(feeCap)}};
  if(chain.chainId===196)Object.assign(quote,{estimatedOKB:quote.estimatedNative,maximumOKB:quote.maximumNative,reservedFixedOKB:quote.reservedFixedNative});
  plan.quote=quote;store.save();return quote;
}
export function beginSigning(store,r,input,at=Date.now()) {
  assertApproved(store,r,'chain');assertPlanTarget(store,r);
  const plan=r.plan,q=plan.quote;
  check(plan&&!plan.pending&&!plan.signing&&plan.completed.length===input.index,'签署状态不允许新交易');
  check(q&&q.id===input.quoteId&&q.index===input.index&&q.planId===plan.id&&q.expiresAt>at,'报价不存在或已过期，请重新估价');
  check(planChain(plan).chainId!==8453||r.budget?.acknowledgeVariableL1===true&&q.variableDataFee===true,'Base 数据费确认已失效');
  check((q.chainId??196)===planChain(plan).chainId && BigInt(q.transaction.chainId??196)===BigInt(planChain(plan).chainId),'报价网络与发布计划不匹配');
  check(q.approvalDigest===approvalDigest(store,r)&&q.stepDigest===digest(plan.steps[input.index]),'报价对应的文件、配置或步骤已变化');
  const later=plan.steps.slice(input.index+1).reduce((n,s)=>n+BigInt(s.value),0n)+BigInt(plan.activationReserveWei||0);
  checkBudget(r,BigInt(q.maximumWei)+later);
  plan.signing={index:input.index,startedAt:new Date(at).toISOString(),quote:q};delete plan.quote;
  store.save();return {recorded:true,transaction:q.transaction,nativeSymbol:q.nativeSymbol||'OKB',maximumNative:q.maximumNative??q.maximumOKB,...(planChain(plan).chainId===196?{maximumOKB:q.maximumOKB}:{})};
}
