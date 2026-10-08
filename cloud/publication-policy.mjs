import {demand} from '../server/core.mjs';
import {reservePublication} from '../server/publication-quota.mjs';

// Both the catalog and the serving manifest matter: a failed catalog commit
// must never turn a live password-protected preview into a public upload.
export async function assertNoPrivatePreview(env,user,release) {
  demand(!['preparing','active'].includes(release.privatePreview?.status),'请先撤销私有预览，再明确公开发布',409);
  const object=await env.ARTIFACTS.get('private/'+release.id+'/manifest.json');
  if(object){
    const meta=await object.json();
    demand(meta.owner===user.id&&meta.manifestHash===release.manifestHash,'预览归属检查失败',409);
    demand(meta.status!=='active','请先撤销私有预览，再明确公开发布',409);
  }
}

export async function beginPublicExposure(env,store,user,release,kind,commit,limits) {
  await assertNoPrivatePreview(env,user,release);
  reservePublication(store,release,limits);
  // Once an external request may have disclosed bytes, privacy cannot be
  // promised again, even if that request or the subsequent catalog save fails.
  release.publicExposure ||= {kind,at:new Date().toISOString()};
  if(['site','cloudflare-production','gateway'].includes(kind)){
    const p=store.project(release.projectId);
    p.pendingPublications ||= [];
    if(!p.pendingPublications.some(x=>x.releaseId===release.id&&x.kind===kind))p.pendingPublications.push({releaseId:release.id,kind});
  }
  store.save();
  await commit();
}

export function finishPublicExposure(store,release,kind) {
  const p=store.project(release.projectId);
  if(p.pendingPublications){p.pendingPublications=p.pendingPublications.filter(x=>x.kind!==kind);store.save();}
}
