import {demand} from './core.mjs';

// A publication reserves one monthly slot before any public bytes or chain
// transaction can escape. Retries and recovery of the same release reuse it.
// The slot becomes successful only after the matching verification succeeds.
export const publicationMonth=(time=Date.now())=>new Date(time).toISOString().slice(0,7);

export function publicationUsage(store,limits,time=Date.now()) {
  const month=publicationMonth(time),limit=limits?.monthlyPublications;
  if(!Number.isSafeInteger(limit))return null;
  const items=store.state.releases.map(r=>r.publicationQuota).filter(q=>q?.month===month);
  const successful=items.filter(q=>q.status==='successful').length;
  const pending=items.filter(q=>q.status==='pending').length;
  return {month,limit,successful,pending,remaining:Math.max(0,limit-successful-pending)};
}

export function reservePublication(store,release,limits,time=Date.now()) {
  const usage=publicationUsage(store,limits,time);
  if(!usage||release.publicationQuota)return;
  // Releases that were already public before this limit was introduced do not
  // become a new publication simply because they are restored or rechecked.
  if(release.publicExposure&&!release.publicationQuota)return;
  demand(usage.remaining>0,'本月免费版发布额度已用完；已开始的版本仍可继续核验或恢复',429);
  release.publicationQuota={month:usage.month,status:'pending',startedAt:new Date(time).toISOString()};
  store.save();
}

export function completePublication(store,release,time=Date.now()) {
  const quota=release.publicationQuota;
  if(!quota||quota.status==='successful')return;
  quota.status='successful';quota.verifiedAt=new Date(time).toISOString();store.save();
}
