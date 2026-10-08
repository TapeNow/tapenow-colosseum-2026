import {createHash} from 'node:crypto';
import {demand} from './core.mjs';

const DAY=86400000;
const stamp=t=>new Date(t).toISOString();
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const archiveState=r=>r.archive?.state||'available';
export const archiveBytes=r=>archiveState(r)==='purged'?0:r.bytes;
export function protectedArchiveReasons(store,r,time=Date.now()) {
  const p=store.project(r.projectId), reasons=[];
  if(r.gateway&&r.gateway.status!=='retired'||p.gateway?.releaseId===r.id)reasons.push('Gateway 固定版本仍可访问，暂时保留归档');
  if([p.productionId,p.siteProductionId,p.cloudflareProductionId,p.cloudflarePendingId].includes(r.id))reasons.push('当前正式或待核验版本');
  if(p.pendingPublications?.some(x=>x.releaseId===r.id))reasons.push('公开入口发布待确认，请重试发布后再清理');
  if(r.archive?.pinned)reasons.push('手动保留点');
  if(r.plan?.pending||r.plan?.signing||r.chainStatus==='publishing'||(r.plan?.completed?.length>0&&r.plan.completed.length<r.plan.steps.length))reasons.push('发布尚未完成');
  if(['preparing','active'].includes(r.privatePreview?.status)&&Date.parse(r.privatePreview.expiresAt)>time)reasons.push('私有预览仍有效');
  const latest=store.state.releases.filter(x=>x.projectId===p.id&&x.chainStatus==='verified').sort((a,b)=>String(b.verification?.verifiedAt||b.createdAt).localeCompare(String(a.verification?.verifiedAt||a.createdAt)))[0];
  if(latest?.id===r.id)reasons.push('最近链上核验版本');
  if(store.state.releases.some(x=>x.restoredFrom===r.id&&archiveState(x)==='available'&&(x.plan?.pending||x.plan?.signing)))reasons.push('在途恢复的来源');
  return reasons;
}
export function retentionReport(store,pid,time=Date.now()) {
  const p=store.project(pid),policy=p.retention||{days:30,enabled:false};
  const releases=store.state.releases.filter(r=>r.projectId===pid).map(r=>{
    const state=archiveState(r),reasons=protectedArchiveReasons(store,r,time);
    return {id:r.id,label:r.label,createdAt:r.createdAt,manifestHash:r.manifestHash,bytes:r.bytes,state,
      pinned:!!r.archive?.pinned,reasons,eligible:state==='available'&&!reasons.length,
      overdue:state==='available'&&!reasons.length&&Date.parse(r.createdAt)<=time-policy.days*DAY,
      trashedAt:r.archive?.trashedAt||null,purgeAfter:r.archive?.purgeAfter||null,purgedAt:r.archive?.purgedAt||null,
      error:r.archive?.error||null,publicCopies:!!(r.publicExposure||r.preview?.url||r.site?.url||r.cloudflare?.url||r.cloudflareProduction?.url)};
  });
  const digest=hash({pid,policy,releases:releases.map(({overdue,...r})=>r)});
  return {policy,digest,releases,graceDays:7,retainedBytes:store.state.releases.filter(r=>r.projectId===pid).reduce((s,r)=>s+archiveBytes(r),0),
    trashBytes:releases.filter(r=>r.state==='trash').reduce((s,r)=>s+r.bytes,0),
    scope:'仅 TapeNow 归档和版本入口；不删除链上、供应商 Pages 或业务数据库'};
}
export function setRetentionPolicy(store,pid,input) {
  demand(Number.isInteger(input.days)&&input.days>=7&&input.days<=365,'保留时间需要为 7–365 天');
  demand(typeof input.enabled==='boolean','请选择是否启用自动到期');
  store.project(pid).retention={days:input.days,enabled:input.enabled};store.save();
  store.log(pid,`归档保留策略：${input.days} 天，自动到期${input.enabled?'启用':'关闭'}`);
  return retentionReport(store,pid);
}
export function setArchivePin(store,rid,pinned) {
  demand(typeof pinned==='boolean','保留点参数无效');const r=store.release(rid);
  demand(!['purging','purged'].includes(archiveState(r)),'此归档已进入清除流程',409);
  demand(archiveState(r)!=='trash'||!pinned,'请先从回收站恢复，再设置保留点',409);
  r.archive={...r.archive,pinned};store.save();return retentionReport(store,r.projectId);
}
export function trashArchives(store,pid,input,time=Date.now()) {
  const report=retentionReport(store,pid,time);
  demand(input.digest===report.digest,'清理列表已变化，请重新查看',409);
  demand(Array.isArray(input.releaseIds)&&input.releaseIds.length>0&&input.releaseIds.length<=150&&new Set(input.releaseIds).size===input.releaseIds.length,'请选择要回收的版本');
  const selected=input.releaseIds.map(id=>report.releases.find(r=>r.id===id));
  demand(selected.every(r=>r?.eligible),'包含受保护或不可回收的版本',409);
  for(const item of selected){const r=store.release(item.id);r.archive={...r.archive,state:'trash',trashedAt:stamp(time),purgeAfter:stamp(time+7*DAY)};}
  store.save();store.log(pid,`${selected.length} 个归档进入回收站，七天后清除；期间可以恢复`);
  return retentionReport(store,pid,time);
}
export function restoreArchive(store,rid,time=Date.now()) {
  const r=store.release(rid);demand(archiveState(r)==='trash','此版本不在可恢复的回收站中',409);
  demand(time<Date.parse(r.archive.purgeAfter),'恢复期已结束',409);
  r.archive={state:'available',pinned:!!r.archive.pinned};store.save();store.log(r.projectId,'归档已从回收站恢复','success',r.id);
  return retentionReport(store,r.projectId,time);
}
// Persist this intent BEFORE deleting any object. Pending intents are retried after a crash.
export function prepareArchivePurge(store,pid,time=Date.now()) {
  const p=store.project(pid),report=retentionReport(store,pid,time);
  if(p.retention?.enabled){const ids=report.releases.filter(r=>r.overdue).map(r=>r.id);if(ids.length)trashArchives(store,pid,{digest:report.digest,releaseIds:ids},time);}
  const pending=[];
  for(const r of store.state.releases.filter(r=>r.projectId===pid)) {
    if(protectedArchiveReasons(store,r,time).length)continue;
    if(archiveState(r)==='trash'&&Date.parse(r.archive.purgeAfter)<=time){
      r.archive={...r.archive,state:'purging',startedAt:stamp(time)};store.save();
    }
    if(archiveState(r)==='purging')pending.push({releaseId:r.id,projectId:pid,manifestHash:r.manifestHash,paths:r.files.map(f=>f.path)});
  }
  return pending;
}
export function finalizeArchivePurge(store,rid,{ok},time=Date.now()) {
  const r=store.release(rid);demand(archiveState(r)==='purging','清除意图不存在',409);
  if(!ok){r.archive.error='存储清除未完成，系统将重试';store.save();return;}
  r.files=r.files.map(({base64,...f})=>f);
  r.archive={...r.archive,state:'purged',purgedAt:stamp(time),error:null};
  if(r.privatePreview)r.privatePreview={...r.privatePreview,status:'revoked'};
  store.save();store.log(r.projectId,'归档清除完成；保留清单和历史回执，链上及外部服务未删除','info',r.id);
}
