import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Wallet} from 'ethers';
import {signupPolicy,sessionUser,walletSubject,walletChallenge,openChallenge,WALLET_CHAINS} from '../cloud/admission.mjs';

const env={APP_ORIGIN:'https://app.tapenow.dev',VAULT_KEY:randomBytes(32).toString('base64'),SIGNUP_MODE:'open',WALLET_LOGIN:'true',SIGNUP_DAILY_LIMIT:'50',SIGNUP_TOTAL_LIMIT:'300'};
const wallet=Wallet.createRandom();

test('signup policy defaults to invite-only and wallet login needs open mode',()=>{
 assert.deepEqual(signupPolicy({}),{mode:'invite',wallet:false,dailyLimit:50,totalLimit:300});
 assert.equal(signupPolicy({WALLET_LOGIN:'true'}).wallet,false);
 assert.deepEqual(signupPolicy(env),{mode:'open',wallet:true,dailyLimit:50,totalLimit:300});
 assert.equal(signupPolicy({...env,SIGNUP_DAILY_LIMIT:'-1',SIGNUP_TOTAL_LIMIT:'x'}).dailyLimit,50);
 assert.throws(()=>walletChallenge({...env,WALLET_LOGIN:'false'},{address:wallet.address,chainId:56}),/暂未开放/);
});

test('challenge is an EIP-4361 message for the app origin on each TapeOut chain',()=>{
 assert.deepEqual(WALLET_CHAINS,[56,196,8453]);
 for(const chainId of WALLET_CHAINS){
  const issued=walletChallenge(env,{address:wallet.address.toLowerCase(),chainId},Date.parse('2026-09-30T00:00:00Z'));
  assert.equal(issued.address,wallet.address,'address is checksummed so one wallet maps to one Supabase identity');
  assert.match(issued.message,/^app\.tapenow\.dev wants you to sign in with your Ethereum account:\n0x[0-9a-fA-F]{40}\n/);
  assert.match(issued.message,new RegExp('\\nURI: https://app\\.tapenow\\.dev/\\nVersion: 1\\nChain ID: '+chainId+'\\nNonce: [\\w-]{24}\\n'));
  assert.match(issued.message,/Expiration Time: 2026-09-30T00:05:00\.000Z$/);
 }
 for(const chainId of [1,0,97,'56abc'])assert.throws(()=>walletChallenge(env,{address:wallet.address,chainId}),/BSC、X Layer 或 Base/);
 assert.throws(()=>walletChallenge(env,{address:'0x1234',chainId:56}),/钱包地址无效/);
});

test('only the exact issued message, signed by its own address before expiry, is accepted',async()=>{
 const time=Date.now(),issued=walletChallenge(env,{address:wallet.address,chainId:196},time);
 const signature=await wallet.signMessage(issued.message);
 const opened=openChallenge(env,{challenge:issued.challenge,message:issued.message,signature},time+1000);
 assert.equal(opened.address,wallet.address);assert.equal(opened.chainId,196);assert.match(opened.nonce,/^[\w-]{24}$/);
 const edited=issued.message.replace('Chain ID: 196','Chain ID: 56'),editedSignature=await wallet.signMessage(edited),stranger=await Wallet.createRandom().signMessage(issued.message);
 assert.throws(()=>openChallenge(env,{challenge:issued.challenge,message:edited,signature:editedSignature},time),/不一致/);
 assert.throws(()=>openChallenge(env,{challenge:issued.challenge,message:issued.message,signature:stranger},time),/签名钱包与登录地址不一致/);
 assert.throws(()=>openChallenge(env,{challenge:issued.challenge,message:issued.message,signature},time+5*60000+1),/已过期/);
 assert.throws(()=>openChallenge(env,{challenge:issued.challenge.slice(0,-2)+'AA',message:issued.message,signature},time),/已失效/);
 assert.throws(()=>openChallenge({...env,VAULT_KEY:randomBytes(32).toString('base64')},{challenge:issued.challenge,message:issued.message,signature},time),/已失效/);
 assert.throws(()=>openChallenge(env,{challenge:issued.challenge,message:issued.message,signature:'0x1234'},time),/格式无效/);
});

test('session user carries the checksummed wallet and keeps email accounts unchanged',()=>{
 assert.deepEqual(sessionUser({id:'u1',email:'a@example.test',app_metadata:{provider:'email'}}),{id:'u1',email:'a@example.test'});
 const address=wallet.address.toLowerCase();
 assert.deepEqual(sessionUser({id:'u2',email:'',app_metadata:{provider:'web3'},user_metadata:{custom_claims:{address}}}),{id:'u2',email:undefined,wallet:wallet.address});
 assert.equal(walletSubject(address),'wallet:'+wallet.address);
});

test('public-beta workspaces get the free plan; invited and internal accounts keep the beta allowance',async()=>{
 const {planLimits,betaCapabilities,betaUsage,BETA_LIMITS,FREE_LIMITS}=await import('../server/beta-policy.mjs');
 assert.deepEqual([FREE_LIMITS.projects,FREE_LIMITS.releases,FREE_LIMITS.archiveBytes],[3,9,100*1024*1024]);
 assert.equal(planLimits('free'),FREE_LIMITS);assert.equal(planLimits('beta'),BETA_LIMITS);assert.equal(planLimits(undefined),BETA_LIMITS);
 const store={state:{projects:[{id:'p-1'}],releases:[],betaPolicy:{legacyProjects:[]}}},user={id:'u',email:''};
 const free=betaCapabilities({BETA_PHASE:'A'},user,store,'free');
 assert.equal(free.plan,'free');assert.equal(free.limits,FREE_LIMITS);
 assert.equal(betaCapabilities({BETA_PHASE:'A'},user,store).limits,BETA_LIMITS);
 const internal=betaCapabilities({BETA_PHASE:'A',PLATFORM_HOSTING_OWNERS:'u'},user,store,'free');
 assert.equal(internal.plan,'beta');assert.equal(internal.limits,BETA_LIMITS,'platform owners are never downgraded');
 assert.equal(betaUsage(store,{count:2},300,free.limits).limits.projects,3);
});
