import {createMemoryStore, emptyState, demand, sha} from '../server/core.mjs';
import {archiveBytes} from '../server/archive-policy.mjs';
import {sharedWorkspaceDatabase} from './memberships.mjs';
import {seal,unseal} from './security.mjs';
export async function database(env,token,path,init={}) {
  const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{...init,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json',...init.headers}});
  if(!r.ok) throw Object.assign(new Error('数据保存未完成'),{status:r.status===401?401:503});
  const body = await r.text();
  return body ? JSON.parse(body) : null;
}
export async function openWorkspace(env,user,token,{actorId=user.id,limits={projects:30,releases:150,archiveBytes:250*1024*1024}}={}) {
  demand(/^[a-f\d-]{36}$/i.test(user.id),'用户身份无效',401);
  const table=env.WORKSPACE_TABLE||'tapenow_workspaces';
  demand(['tapenow_workspaces','tapenow_production_workspaces'].includes(table),'工作空间配置无效',503);
  const shared=actorId!==user.id;
  const rows=shared?await sharedWorkspaceDatabase(env,actorId,user.id):await database(env,token,table+'?owner_id=eq.'+user.id+'&select=payload,version');
  demand(!shared||rows.length===1,'工作空间不存在',404);
  let row=rows[0]; const state=row?unseal(row.payload,env.VAULT_KEY,'workspace:'+user.id):emptyState();
  let dirty=false;
  const store=createMemoryStore({state,mode:"cloud",vaultKey:Buffer.from(env.VAULT_KEY,'base64'),privateKey:env.SIGNING_PRIVATE_KEY,publicKey:env.SIGNING_PUBLIC_KEY,keyHistory:env.SIGNING_KEY_HISTORY||[],onSave:()=>{dirty=true}});
  const existing=new Set(state.releases.map(r=>r.id));
  const initial={projects:state.projects.length,releases:state.releases.filter(r=>r.archive?.state!=='purged').length,bytes:state.releases.reduce((n,r)=>n+archiveBytes(r),0)};
  async function hydrate(rid) {
    const r=store.release(rid); if(['purging','purged'].includes(r.archive?.state)||r.files[0]?.base64!==undefined)return;
    const a=await env.ARTIFACTS.get(user.id+'/'+rid+'.json');
    demand(a,'归档文件暂时不可用',503); const files=await a.json();
    r.files=files;store.validateRelease(r);
  }
  function assertLimits() {
    // Limits only stop growth: a workspace already above them may still delete, restore or export.
    demand(state.projects.length<=Math.max(limits.projects,initial.projects),`当前额度每个账户最多 ${limits.projects} 个项目`,429);
    demand(state.releases.filter(r=>r.archive?.state!=='purged').length<=Math.max(limits.releases,initial.releases) && state.releases.reduce((n,r)=>n+archiveBytes(r),0)<=Math.max(limits.archiveBytes,initial.bytes),'归档额度已用完，请先回收不需要的版本',429);
  }
  async function commit() {
    if(!dirty)return;
    assertLimits();
    for(const r of state.releases)if(!existing.has(r.id)&&!['purging','purged'].includes(r.archive?.state)) {
      store.validateRelease(r);
      await env.ARTIFACTS.put(user.id+'/'+r.id+'.json',JSON.stringify(r.files),{httpMetadata:{contentType:'application/json'}});
    }
    const snapshot={...state,releases:state.releases.map(r=>({...r,files:r.files.map(({base64,...f})=>f)}))};
    const payload=seal(snapshot,env.VAULT_KEY,'workspace:'+user.id);
    // Durable Object serializes this owner's operations; CAS also catches any external writer.
    if(row) {
      const updated=shared?await sharedWorkspaceDatabase(env,actorId,user.id,{payload,version:row.version}):await database(env,token,table+'?owner_id=eq.'+user.id+'&version=eq.'+row.version,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({payload,version:row.version+1,updated_at:new Date().toISOString()})});
      demand(updated.length===1,'工作空间已更新，请刷新后重试',409);
    }else await database(env,token,table,{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({owner_id:user.id,payload,version:1})});
    row={version:(row?.version||0)+1};
    for(const r of state.releases)existing.add(r.id);
    dirty=false;
  }
  return {store,hydrate,commit,existing,assertLimits};
}
