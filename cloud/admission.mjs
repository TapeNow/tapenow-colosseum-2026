import {getAddress,verifyMessage} from 'ethers';
import {demand} from '../server/core.mjs';
import {adminRequest,accessEnvironment,accessAllowed} from './access.mjs';
import {nonce,seal,unseal} from './security.mjs';
import {walletLink} from './wallet-links.mjs';

// TapeOut publishes on these three networks only. The SIWE Chain ID is recorded
// for context; one wallet address is one TapeNow account on every chain.
export const WALLET_CHAINS=Object.freeze([56,196,8453]);
const CHALLENGE_TTL=5*60000;
const limit=(value,fallback)=>{const n=Number(value??fallback);return Number.isSafeInteger(n)&&n>=0&&n<=100000?n:fallback;};
export function signupPolicy(env) {
  const open=env.SIGNUP_MODE==='open';
  return {mode:open?'open':'invite',wallet:open&&env.WALLET_LOGIN==='true',dailyLimit:limit(env.SIGNUP_DAILY_LIMIT,50),totalLimit:limit(env.SIGNUP_TOTAL_LIMIT,300)};
}
export const walletSubject=address=>'wallet:'+getAddress(address);
export function sessionUser(user) {
  const address=user?.app_metadata?.provider==='web3'||!user?.email?user?.user_metadata?.custom_claims?.address:undefined;
  return {id:user.id,email:user.email||undefined,...(address?{wallet:getAddress(address)}:{})};
}

// Challenge text follows EIP-4361. The Worker, not the browser, chooses domain,
// URI, checksummed address, nonce and expiry, and seals them so the verify step
// accepts only the exact message it issued. The nonce is consumed once in a
// Durable Object because Supabase Auth itself accepts a replayed signature.
export function walletChallenge(env,input,time=Date.now(),purpose='login',userId='') {
  demand(purpose==='link'||signupPolicy(env).wallet,'钱包登录暂未开放',403);
  if(purpose==='link')demand(/^[a-f\d-]{36}$/i.test(userId),'账号无效',400);
  let address;try{address=getAddress(String(input.address||''));}catch{demand(false,'钱包地址无效');}
  const chainId=Number(input.chainId);demand(WALLET_CHAINS.includes(chainId),'请切换到 BSC、X Layer 或 Base');
  const origin=new URL(env.APP_ORIGIN), id=nonce().slice(0,24);
  const message=`${origin.host} wants you to ${purpose==='link'?'link':'sign in with'} your Ethereum account:
${address}

${purpose==='link'?`Link this wallet to TapeNow account ${userId}. Future wallet sign-ins will open that account.`:'Sign in to TapeNow.'} This signature does not send a transaction or cost gas.

URI: ${origin.origin}/
Version: 1
Chain ID: ${chainId}
Nonce: ${id}
Issued At: ${new Date(time).toISOString()}
Expiration Time: ${new Date(time+CHALLENGE_TTL).toISOString()}`;
  return {address,chainId,message,challenge:seal({message,address,chainId,nonce:id,expiresAt:time+CHALLENGE_TTL,purpose,userId},env.VAULT_KEY,'wallet-challenge'),expiresAt:time+CHALLENGE_TTL};
}
export function openChallenge(env,input,time=Date.now(),purpose='login',userId='') {
  let sealed;try{sealed=unseal(String(input.challenge||''),env.VAULT_KEY,'wallet-challenge');}catch{demand(false,'登录请求已失效，请重新连接钱包',401);}
  demand(sealed.message===input.message,'签名内容与登录请求不一致',401);
  demand(sealed.purpose===purpose&&sealed.userId===userId,'签名用途与账号不匹配',401);
  demand(sealed.expiresAt>time,'登录请求已过期，请重新签名',401);
  const signature=String(input.signature||'');demand(/^0x[0-9a-fA-F]{130}$/.test(signature),'钱包签名格式无效',401);
  let signer;try{signer=verifyMessage(sealed.message,signature);}catch{demand(false,'钱包签名无效',401);}
  demand(signer===sealed.address,'签名钱包与登录地址不一致',401);
  return {...sealed,signature};
}

const rpc=(env,name,body)=>adminRequest(env,'/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(body)});
const admissions=env=>'/rest/v1/tapenow_admissions?environment=eq.'+accessEnvironment(env);
// Checked before sending an email code so a full day does not send unusable mail.
// Returning users keep their seat. tapenow_admit remains the authoritative check.
// True for any recorded subject, including revoked ones (they are refused later, not re-admitted).
export async function seatHeld(env,subject) {
  return (await adminRequest(env,admissions(env)+'&subject=eq.'+encodeURIComponent(subject)+'&select=status')).length>0;
}
export async function assertSeatAvailable(env,subject) {
  if(await seatHeld(env,subject))return;
  const policy=signupPolicy(env);
  const [row]=await rpc(env,'tapenow_admission_capacity',{target_environment:accessEnvironment(env),daily_limit:policy.dailyLimit,total_limit:policy.totalLimit});
  demand(Number(row?.total_used)<policy.totalLimit,'本阶段公测名额已满，请关注后续开放',403);
  demand(row?.open===true,'今天的公测名额已满，请明天再来',403);
}
export async function admit(env,user,kind,subject) {
  const policy=signupPolicy(env);
  const [row]=await rpc(env,'tapenow_admit',{target_environment:accessEnvironment(env),target_user:user.id,target_kind:kind,target_subject:subject,daily_limit:policy.dailyLimit,total_limit:policy.totalLimit});
  demand(row?.status!=='daily_full','今天的公测名额已满，请明天再来',403);
  demand(row?.status!=='total_full','本阶段公测名额已满，请关注后续开放',403);
  demand(row?.status==='active','此账号的访问已被停用',403);
  return row;
}
async function admitted(env,userId) {
  const rows=await adminRequest(env,admissions(env)+'&user_id=eq.'+encodeURIComponent(userId)+'&select=status');
  return rows[0]?.status==='active';
}
// Invitations stay authoritative for email accounts: an invited or active email
// never needs a seat. Everyone else must hold an active admission row.
export async function userAllowed(env,user) {
  if(user?.wallet){const link=await walletLink(env,user.wallet);if(link&&link.user_id!==user.id)return false;}
  if(user?.email&&await accessAllowed(env,user.email.toLowerCase()))return true;
  if(!env.SUPABASE_ADMIN_KEY)return false;
  return admitted(env,user.id);
}
// A workspace's plan follows its owner. Only public-beta sign-ups have admission
// rows, so invited and operator accounts keep the invitation-beta allowance.
export async function workspacePlan(env,ownerId) {
  if(!env.SUPABASE_ADMIN_KEY)return 'beta';
  const rows=await adminRequest(env,admissions(env)+'&user_id=eq.'+encodeURIComponent(ownerId)+'&select=kind');
  return rows.length?'free':'beta';
}
