import {demand,id,now} from './core.mjs';
import {digest,assertApproved} from './release-policy.mjs';
import {nativeUrl} from './chains.mjs';

const binding=(store,r)=>digest({releaseId:r.id,manifestHash:r.manifestHash,target:store.project(r.projectId).chain,verification:r.verification,approval:r.approval?.digest});
export function startNativeAccess(store,r,time=Date.now()) {
  assertApproved(store,r,'chain');
  demand(r.chainStatus==='verified'&&r.verification,'请先完成链上文件读回核验',409);
  demand(r.activation?.live&&Number(r.activation.paidUntil)*1000>time,'原生入口未激活或已过期',409);
  demand(!r.plan?.pending&&!r.plan?.signing,'先恢复待确认交易',409);
  const url=nativeUrl(store.project(r.projectId).chain);
  r.nativeAccess={status:'pending',checkId:id('access'),binding:binding(store,r),url,expiresAt:time+10*60000,startedAt:now()};
  store.save();return r.nativeAccess;
}
export function confirmNativeAccess(store,r,input,time=Date.now()) {
  assertApproved(store,r,'chain');
  const check=r.nativeAccess;
  demand(check?.status==='pending'&&check.checkId===input.checkId&&check.expiresAt>time&&check.binding===binding(store,r),'入口检查已过期或文件／目标已变化，请重新检查',409);
  demand(Number(r.activation?.paidUntil)*1000>time&&r.activation.live,'原生入口已过期',409);
  // TapeKit serves the application through a same-origin Service Worker. A
  // cross-origin HTTP fetch can see its boot shell, not the visited application.
  // An explicit observation is recorded honestly, never as a cryptographic proof.
  demand(input.opened===true&&input.assetsLoaded===true&&input.expectedVersion===true,'请先在原生网址检查版本、图片和交互，再确认结果',409);
  r.nativeAccess={...check,status:'observed',observedAt:now(),scope:'user-browser-observation',manifestHash:r.manifestHash};
  delete r.nativeAccess.checkId;
  store.project(r.projectId).nativeProductionId=r.id;
  store.promote(r.projectId,r.id);
  r.receipt=store.receiptFor(r,'chain-with-browser-observation');store.save();
  store.log(r.projectId,'已记录原生入口浏览器检查；链上内容核验与用户观察分别保留','success',r.id);
  return r.nativeAccess;
}
