import {getAddress} from 'ethers';
import {demand} from '../server/core.mjs';
import {adminRequest,accessEnvironment} from './access.mjs';
import {authFetch,unseal} from './security.mjs';

const table=env=>'/rest/v1/tapenow_wallet_links?environment=eq.'+accessEnvironment(env);
const canonical=value=>{try{return getAddress(String(value));}catch{demand(false,'钱包地址无效');}};

export async function walletLink(env,address){
  const rows=await adminRequest(env,table(env)+'&address=eq.'+canonical(address).toLowerCase()+'&select=address,user_id,linked_at');
  return rows[0]||null;
}
export async function linkedWallet(env,userId){
  const rows=await adminRequest(env,table(env)+'&user_id=eq.'+encodeURIComponent(userId)+'&select=address,linked_at');
  return rows[0]?{address:getAddress(rows[0].address),linkedAt:rows[0].linked_at}:null;
}
export async function walletOnlyAccount(env,address){
  const rows=await adminRequest(env,'/rest/v1/tapenow_admissions?environment=eq.'+accessEnvironment(env)+'&subject=eq.'+encodeURIComponent('wallet:'+canonical(address))+'&select=user_id,status');
  return rows[0]||null;
}
async function assertEmptyWalletAccount(env,address,userId){
  const old=await walletOnlyAccount(env,address);
  if(!old||old.user_id===userId)return;
  demand(old.status==='active','此钱包的独立账号已停用，不能绑定',409);
  const tableName=env.WORKSPACE_TABLE||'tapenow_workspaces';
  demand(['tapenow_workspaces','tapenow_production_workspaces'].includes(tableName),'工作空间配置无效',503);
  const [rows,memberships]=await Promise.all([
    adminRequest(env,'/rest/v1/'+tableName+'?owner_id=eq.'+old.user_id+'&select=payload'),
    adminRequest(env,'/rest/v1/tapenow_project_memberships?environment=eq.'+accessEnvironment(env)+'&member_id=eq.'+old.user_id+'&select=project_id&limit=1')
  ]);
  const state=rows[0]?unseal(rows[0].payload,env.VAULT_KEY,'workspace:'+old.user_id):null;
  const hasData=state&&(state.projects?.length||state.releases?.length||state.domains?.length||Object.keys(state.connections||{}).length);
  demand(!hasData&&!memberships.length,'此钱包已有独立项目或连接；请先处理账号数据，再绑定',409);
}
export async function saveWalletLink(env,user,address){
  demand(user?.email&&user?.id,'请先使用邮箱账号登录',403);
  address=canonical(address);
  const [existing,assigned]=await Promise.all([walletLink(env,address),linkedWallet(env,user.id)]);
  demand(!existing||existing.user_id===user.id,'这个钱包已绑定另一个邮箱账号',409);
  demand(!assigned||assigned.address===address,'这个邮箱账号已绑定另一个钱包',409);
  if(!existing){
    await assertEmptyWalletAccount(env,address,user.id);
    try{await adminRequest(env,'/rest/v1/tapenow_wallet_links',{method:'POST',body:JSON.stringify({environment:accessEnvironment(env),address:address.toLowerCase(),user_id:user.id})});}
    catch(e){if(e.providerStatus===409)demand(false,'钱包刚被其他账号绑定，请刷新后重试',409);throw e;}
  }
  return {address,linked:true};
}
export async function walletAliasTokens(env,link){
  const user=await adminRequest(env,'/auth/v1/admin/users/'+link.user_id);
  demand(user?.id===link.user_id&&user.email,'绑定账号已失效',403);
  // Admin generate_link returns the OTP without delivering an email. Redeeming
  // it through GoTrue yields a normal user JWT, preserving existing RLS and data.
  const generated=await adminRequest(env,'/auth/v1/admin/generate_link',{method:'POST',body:JSON.stringify({type:'magiclink',email:user.email})});
  demand(generated?.email_otp,'钱包登录暂时不可用',503);
  const tokens=await authFetch(env,'/verify',{email:user.email,token:generated.email_otp,type:'email'});
  demand(tokens.user?.id===link.user_id&&tokens.user?.email?.toLowerCase()===user.email.toLowerCase(),'绑定账号身份不匹配',401);
  return tokens;
}
