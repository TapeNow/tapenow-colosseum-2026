import {demand} from '../server/core.mjs';
import {authFetch} from './security.mjs';
export const accessEnvironment=env=>env.WORKSPACE_TABLE==='tapenow_production_workspaces'?'production':'development';
export const operator=(env,user)=>!!user?.email&&(env.OPERATOR_EMAILS||'').split(',').map(s=>s.trim().toLowerCase()).includes(user.email.toLowerCase());
export function workspaceMutationLimit(env,actor,ownerId) {
  const selected=actor?.id===ownerId&&operator(env,actor)?env.OPERATOR_DAILY_MUTATIONS??env.DAILY_MUTATIONS:env.DAILY_MUTATIONS;
  const value=Number(selected??300);return Number.isSafeInteger(value)&&value>0&&value<=10000?value:300;
}
export const emailAddress=value=>{const email=String(value||'').trim().toLowerCase();demand(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=254,'请输入有效邮箱');return email;};
export async function adminRequest(env,path,init={},fetcher=fetch) {
  demand(env.SUPABASE_ADMIN_KEY,'邀请服务尚未配置',503);
  const response=await fetcher(env.SUPABASE_URL+path,{...init,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{apikey:env.SUPABASE_ADMIN_KEY,Authorization:'Bearer '+env.SUPABASE_ADMIN_KEY,'Content-Type':'application/json',...init.headers}});
  const raw=await response.text();let data;try{data=raw?JSON.parse(raw):null;}catch{}
  if(!response.ok)throw Object.assign(new Error(response.status===429?'邮件请求过于频繁，请稍后重试':'邀请服务暂时无法完成请求'),{status:response.status===429?429:503,providerCode:data?.code,providerStatus:response.status});
  return data;
}
const collection=env=>'/rest/v1/tapenow_access?environment=eq.'+accessEnvironment(env);
const target=(env,email)=>collection(env)+'&email=eq.'+encodeURIComponent(email);
export async function accessRecord(env,email){const rows=await adminRequest(env,target(env,email)+'&select=*');return rows[0]||null;}
export async function accessAllowed(env,email,time=Date.now()) {
  // Legacy installations can upgrade without deploying the privileged key first.
  // Once configured, database failures fail closed, including for operators.
  const record=env.SUPABASE_ADMIN_KEY?await accessRecord(env,email):null;
  if(record)return record.status==='active'||record.status==='invited'&&Date.parse(record.expires_at)>time;
  return (env.SIGNUP_ALLOWLIST||'').split(',').map(s=>s.trim().toLowerCase()).includes(email);
}
export async function acceptInvitation(env,email) {
  if(!env.SUPABASE_ADMIN_KEY)return;
  await adminRequest(env,target(env,email)+'&status=eq.invited&expires_at=gt.'+encodeURIComponent(new Date().toISOString()),{method:'PATCH',body:JSON.stringify({status:'active',accepted_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
}
export async function listInvitations(env,user){demand(operator(env,user),'只有平台维护者可以管理邀请',403);return {items:await adminRequest(env,collection(env)+'&select=email,status,created_at,expires_at,accepted_at,last_sent_at,delivery&order=created_at.desc&limit=200'),limit:200};}
export async function inviteUser(env,user,input) {
  demand(operator(env,user),'只有平台维护者可以管理邀请',403);
  const email=emailAddress(input.email), prior=await accessRecord(env,email),time=Date.now();
  demand(!operator(env,{email}),'维护者账号通过部署配置管理',409);
  demand(!prior?.last_sent_at||time-Date.parse(prior.last_sent_at)>=60000,'请等待一分钟再发送',429);
  const active=prior?.status==='active';
  if(prior?.status==='revoked')demand(input.reinvite===true,'请明确确认重新邀请已撤销的邮箱',409);
  const item={environment:accessEnvironment(env),email,status:active?'active':'invited',created_by:user.id,
    expires_at:new Date(time+7*86400000).toISOString(),updated_at:new Date(time).toISOString(),last_sent_at:new Date(time).toISOString(),delivery:'sending',...(!active?{accepted_at:null}:{})};
  if(prior){
    const changed=await adminRequest(env,target(env,email)+'&updated_at=eq.'+encodeURIComponent(prior.updated_at)+'&status=eq.'+prior.status,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(item)});
    demand(changed?.length===1,'邀请状态已变化，请刷新后重试',409);
  }else{
    try{await adminRequest(env,'/rest/v1/tapenow_access',{method:'POST',body:JSON.stringify(item)});}
    catch(e){if(e.providerStatus===409)demand(false,'邀请状态已变化，请刷新后重试',409);throw e;}
  }
  const deliveryTarget=target(env,email)+'&updated_at=eq.'+encodeURIComponent(item.updated_at)+'&status=neq.revoked';
  try {
    try {await adminRequest(env,'/auth/v1/invite',{method:'POST',body:JSON.stringify({email})});}
    catch(e){if(e.providerStatus===422&&e.providerCode==='email_exists')await authFetch(env,'/otp',{email,create_user:false});else throw e;}
    await adminRequest(env,deliveryTarget,{method:'PATCH',body:JSON.stringify({delivery:'accepted'})});
  } catch(e) {await adminRequest(env,deliveryTarget,{method:'PATCH',body:JSON.stringify({delivery:'failed'})});throw e;}
  return {sent:true,expiresAt:item.expires_at,message:'供应商已接受邮件；收到并完成验证码登录后，邀请才会显示已接受。'};
}
export async function revokeInvitation(env,user,input) {
  demand(operator(env,user),'只有平台维护者可以管理邀请',403);const email=emailAddress(input.email);
  demand(!operator(env,{email}),'维护者账号通过部署配置管理',409);
  const prior=await accessRecord(env,email);demand(prior,'邀请记录不存在',404);
  await adminRequest(env,target(env,email),{method:'PATCH',body:JSON.stringify({status:'revoked',updated_at:new Date().toISOString()})});
  return {revoked:true,scope:'此邮箱的 TapeNow 会话在下一次请求时拒绝；不会删除其数据库或供应商账号'};
}
