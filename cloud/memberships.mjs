import {demand} from '../server/core.mjs';
import {adminRequest,accessEnvironment,accessAllowed,emailAddress} from './access.mjs';
import {assertNotSuspended} from '../server/project-access.mjs';
import {getAddress} from 'ethers';
import {walletLink,walletOnlyAccount} from './wallet-links.mjs';
import {userAllowed} from './admission.mjs';
const uuid=value=>{demand(/^[a-f\d-]{36}$/i.test(value||''),'工作空间无效',400);return value;};
const base=env=>'/rest/v1/tapenow_project_memberships?environment=eq.'+accessEnvironment(env);
export async function listMemberships(env,actorId,ownerId){
  uuid(actorId);if(ownerId)uuid(ownerId);
  return adminRequest(env,base(env)+'&member_id=eq.'+actorId+(ownerId?'&owner_id=eq.'+ownerId:'')+'&select=owner_id,project_id,role,updated_at');
}
export async function projectStatus(env,ownerId,projectId){
  uuid(ownerId);demand(/^p-[a-f0-9]{12}$/.test(projectId),'项目无效');
  const rows=await adminRequest(env,'/rest/v1/tapenow_project_status?environment=eq.'+accessEnvironment(env)+'&owner_id=eq.'+ownerId+'&project_id=eq.'+projectId+'&select=suspended,reason,updated_at');return rows[0]||{suspended:false};
}
export async function assertProjectServing(env,ownerId,projectId){assertNotSuspended(await projectStatus(env,ownerId,projectId));}
export async function manageMembership(env,actor,ownerId,projectId,method,input={}){
  demand(actor.id===ownerId,'只有所有者可以管理成员',403);uuid(ownerId);
  const path=base(env)+'&owner_id=eq.'+ownerId+'&project_id=eq.'+encodeURIComponent(projectId);
  if(method==='GET')return {items:await adminRequest(env,path+'&select=member_id,email,role,updated_at')};
  let email,memberId;
  if(input.wallet){
    let address;try{address=getAddress(String(input.wallet));}catch{demand(false,'钱包地址无效');}
    email='wallet:'+address;
    const link=await walletLink(env,address),standalone=link?null:await walletOnlyAccount(env,address);
    memberId=link?.user_id||standalone?.user_id;
    demand(memberId,'钱包账号尚未创建，请先让对方签名登录',404);
    if(method!=='DELETE'){
      if(link){const user=await adminRequest(env,'/auth/v1/admin/users/'+memberId);demand(user?.id===memberId&&await userAllowed(env,user),'绑定账号未获平台访问资格',403);}
      else demand(standalone.status==='active','钱包账号已被停用',403);
    }
  }else{
    email=emailAddress(input.email);
    if(method!=='DELETE')demand(await accessAllowed(env,email),'该账号未获平台邀请',403);
    const users=await adminRequest(env,'/rest/v1/rpc/tapenow_member_identity',{method:'POST',body:JSON.stringify({target_email:email})});
    memberId=users?.[0]?.id;
  }
  demand(memberId,'账号尚未创建，请先完成登录',404);demand(memberId!==ownerId,'所有者角色不可修改',409);
  if(method==='DELETE')await adminRequest(env,path+'&member_id=eq.'+memberId,{method:'DELETE'});
  else {demand(['viewer','publisher'].includes(input.role),'成员角色无效');await adminRequest(env,'/rest/v1/tapenow_project_memberships?on_conflict=environment,owner_id,project_id,member_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({environment:accessEnvironment(env),owner_id:ownerId,project_id:projectId,member_id:memberId,email,role:input.role,updated_by:actor.id,updated_at:new Date().toISOString()})});}
  return {saved:true};
}
export async function suspendProject(env,actor,ownerId,projectId,input){
  demand(typeof input.suspended==='boolean','暂停状态无效');const reason=String(input.reason||'').trim();demand(reason.length>=2&&reason.length<=500,'请提供 2–500 字符的原因');
  await adminRequest(env,'/rest/v1/tapenow_project_status?on_conflict=environment,owner_id,project_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({environment:accessEnvironment(env),owner_id:ownerId,project_id:projectId,suspended:input.suspended,reason,updated_by:actor.id,updated_at:new Date().toISOString()})});return {suspended:input.suspended,reason,boundary:'暂停 TapeNow 托管入口和新发布；无法删除链上内容或撤回第三方副本'};
}
export async function sharedWorkspaceDatabase(env,actorId,ownerId,{payload=null,version=null}={}){
  uuid(actorId);uuid(ownerId);
  return adminRequest(env,'/rest/v1/rpc/tapenow_shared_workspace',{method:'POST',body:JSON.stringify({target_environment:accessEnvironment(env),target_owner:ownerId,target_actor:actorId,next_payload:payload,expected_version:version})});
}
