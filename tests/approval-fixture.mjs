import {approveRelease,readiness,restoreCheck} from '../server/release-policy.mjs';
export function approve(store,r,intent='cloud',maxBudgetOKB='10') {
  return approveRelease(store,r,{digest:readiness(store,r).digest,intent,maxBudgetOKB,acknowledgeUnknown:true,acknowledgeLegacy:true,acknowledgeRestore:true});
}
export const restoreInput=(store,r)=>({digest:restoreCheck(store,r).digest,acknowledgeUnknown:true});
