import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,generateKeyPairSync,sign} from 'node:crypto';
import {createMemoryStore,parseFiles} from '../server/core.mjs';
import {readiness,approveRelease,assertApproved,restoreCheck,parseOKB,formatOKB,recordExpense,budgetSummary,publicationStatus,digest} from '../server/release-policy.mjs';
import {quoteStep,beginSigning} from '../server/publication-budget.mjs';
import {keyRegistry,verifyTrustedReceipt} from '../server/receipt-keys.mjs';
import {approve,restoreInput} from './approval-fixture.mjs';
const pair=()=>generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const artifact=()=>parseFiles({files:[{path:'index.html',base64:Buffer.from('<h1>Release</h1>').toString('base64')}]});
function fixture(){const keys=pair(),s=createMemoryStore({vaultKey:randomBytes(32),privateKey:keys.privateKey,publicKey:keys.publicKey}),p=s.createProject('Guarded release'),r=s.createRelease(p.id,artifact());return {s,p,r,keys};}
function plan(s,p,r){p.chain={chainId:196,cpuIndex:'231',tokenId:'12'};approve(s,r,'chain','0.001');r.plan={id:'plan-test',manifestHash:r.manifestHash,targetDigest:digest(p.chain),from:'0x'+'1'.repeat(40),steps:[{kind:'putFile',to:'0x'+'2'.repeat(40),data:'0xabcd',value:'0'}],completed:[],activationReserveWei:'10'};return r.plan;}
const quoteInput={gas:21000n,gasPrice:100000n,balance:10n**18n,at:1000};
test('approval binds artifacts, configuration, secret reference, provider, chain and domain; stale digests cannot approve',()=>{
 const {s,p,r}=fixture();assert.throws(()=>s.promote(p.id,r.id),/确认/);approve(s,r);assertApproved(s,r);
 const stale=readiness(s,r).digest;p.environment.push({id:'runtime-1',key:'API_URL',environment:'production',stage:'runtime',value:'https://api.example',secret:false});
 assert.throws(()=>assertApproved(s,r),/失效/);assert.equal(readiness(s,r).buildChanged,false);
 assert.throws(()=>approveRelease(s,r,{digest:stale,intent:'cloud',acknowledgeUnknown:true}),/已变化/);approve(s,r);
 p.environment.push({id:'secret-1',key:'PRIVATE_KEY',environment:'production',stage:'runtime',value:'••••••••',secret:true});s.state.connections[p.id+':env:secret-1']={provider:'secret',projectId:p.id,secrets:s.encrypt({value:'NEVER_PUBLISH_THIS_SECRET'})};
 approve(s,r);assert.ok(!JSON.stringify(readiness(s,r)).includes('NEVER_PUBLISH'));
 p.environment.at(-1).id='secret-2';assert.equal(readiness(s,r).approved,false);approve(s,r);
 s.state.connections[p.id+':cloudflare:production']={provider:'cloudflare',projectId:p.id,environment:'production',secrets:s.encrypt({token:'sensitive',accountId:'account-A'})};assert.equal(readiness(s,r).approved,false);approve(s,r);
 s.state.connections[p.id+':cloudflare:production'].secrets=s.encrypt({token:'sensitive',accountId:'account-B'});assert.equal(readiness(s,r).approved,false);approve(s,r);
 p.chain.tokenId='9';assert.equal(readiness(s,r).approved,false);approve(s,r);s.state.domains.push({projectId:p.id,hostname:'www.example.org'});assert.equal(readiness(s,r).approved,false);approve(s,r);
 const other=s.createRelease(p.id,artifact());other.approval=r.approval;assert.equal(readiness(s,other).approved,false);
 r.manifestHash='0'.repeat(64);assert.equal(readiness(s,r).approved,false);
});
test('build changes require a new artifact; runtime changes can be explicitly approved; legacy needs an attestation',()=>{
 const {s,p,r}=fixture();approve(s,r);p.environment.push({id:'build',key:'PUBLIC_API',environment:'production',value:'new'});
 assert.equal(readiness(s,r).buildChanged,true);assert.throws(()=>approve(s,r),/重新构建/);
 const next=s.createRelease(p.id,artifact());approve(s,next);assertApproved(s,next);
 delete next.configuration;delete next.buildDigest;delete next.approval;
 assert.throws(()=>approveRelease(s,next,{digest:readiness(s,next).digest,intent:'cloud',acknowledgeUnknown:true}),/历史/);
 approve(s,next);assert.ok(next.configurationAttestedAt);assertApproved(s,next);
});
test('restore blocks incompatible data, binds acknowledgment and preserves current publication, old configuration and secrets',()=>{
 const {s,p,r}=fixture();r.databaseContract={usesDatabase:true,versions:['v1']};p.databaseVersion='v2';
 assert.equal(restoreCheck(s,r).allowed,false);assert.throws(()=>s.restore(p.id,r.id,restoreInput(s,r)),/不兼容/);
 delete r.databaseContract;const before=restoreInput(s,r);p.databaseVersion='v3';assert.throws(()=>s.restore(p.id,r.id,before),/过期/);
 assert.throws(()=>s.restore(p.id,r.id,{digest:restoreCheck(s,r).digest}),/明确/);
 const old=r.configuration,connections=JSON.stringify(s.state.connections);p.productionId='current-other';p.siteProductionId='live-other';const restored=s.restore(p.id,r.id,restoreInput(s,r));
 assert.deepEqual(restored.configuration,old);assert.equal(p.productionId,'current-other');assert.equal(p.siteProductionId,'live-other');assert.equal(restored.approval,undefined);assert.equal(JSON.stringify(s.state.connections),connections);
 assert.throws(()=>approveRelease(s,restored,{digest:readiness(s,restored).digest,intent:'cloud',acknowledgeUnknown:true}),/恢复旧产物/);
 approve(s,restored);assert.equal(publicationStatus(s,restored).status,'ready');
 p.databaseVersion='v4';assert.equal(readiness(s,restored).approved,false);
});
test('budget uses exact wei, bounds wallet request, reserves activation and rejects expired or substituted quotes',()=>{
 assert.equal(parseOKB('0.000000000000000001'),1n);assert.equal(formatOKB(100000000000000001n),'0.100000000000000001');
 for(const amount of ['1e-3','-1','0.0000000000000000001','NaN',1])assert.throws(()=>parseOKB(amount));
 const {s,p,r}=fixture();plan(s,p,r);const q=quoteStep(s,r,quoteInput);
 assert.equal(q.reservedFixedOKB,'0.00000000000000001');assert.equal(BigInt(q.transaction.gas),47300n);assert.ok(BigInt(q.maximumWei)<=parseOKB('0.001'));
 assert.throws(()=>beginSigning(s,r,{index:0,quoteId:q.id},61000),/过期/);
 assert.throws(()=>beginSigning(s,r,{index:0,quoteId:'forged'},1100),/报价/);
 r.plan.steps[0].data='0xabab';assert.throws(()=>beginSigning(s,r,{index:0,quoteId:q.id},1100),/步骤/);
 const q2=quoteStep(s,r,quoteInput),intent=beginSigning(s,r,{index:0,quoteId:q2.id},1100);assert.deepEqual(intent.transaction,q2.transaction);
 assert.throws(()=>beginSigning(s,r,{index:0,quoteId:q2.id},1101),/签署状态/);
 delete r.plan.signing;r.budget.capWei='10';assert.throws(()=>quoteStep(s,r,quoteInput),/剩余预算/);
 r.budget.capWei=String(10n**18n);assert.throws(()=>quoteStep(s,r,{...quoteInput,gasPrice:0n}),/报价/);assert.throws(()=>quoteStep(s,r,{...quoteInput,walletCode:'0xef0100'}),/智能账户/);
 assert.throws(()=>quoteStep(s,r,{...quoteInput,balance:1n}),/余额不足/);
 p.chain.tokenId='13';approve(s,r,'chain');assert.throws(()=>quoteStep(s,r,quoteInput),/链目标/);
});
test('failed fees and successful value persist across reapproval; duplicate confirmation cannot double charge; unknown fees fail closed',()=>{
 const {s,p,r}=fixture();plan(s,p,r);
 recordExpense(r,{hash:'0xfailed',gasWei:7n,valueWei:1000n,success:false});
 recordExpense(r,{hash:'0xsuccess',gasWei:3n,valueWei:11n,success:true});
 recordExpense(r,{hash:'0xsuccess',gasWei:3n,valueWei:11n,success:true});
 assert.equal(budgetSummary(r).spentWei,'21');approve(s,r,'chain','0.002');assert.equal(budgetSummary(r).spentWei,'21');
 assert.throws(()=>approve(s,r,'chain','0.00000000000000002'),/低于/);
 recordExpense(r,{hash:'0xunknown',gasWei:null,valueWei:0n,success:true});assert.equal(budgetSummary(r).unknown,true);assert.throws(()=>quoteStep(s,r,quoteInput),/无法核定/);
 const next=s.createRelease(p.id,artifact());next.transactions.push({hash:'0xlegacy'});assert.equal(budgetSummary(next).unknown,true);assert.throws(()=>approve(s,next,'chain'),/核验/);
});
test('workflow never confuses partial writes, pending signatures, verification, expired access or superseded publication with completion',()=>{
 const {s,p,r}=fixture();plan(s,p,r);r.plan.signing={index:0};assert.equal(publicationStatus(s,r).status,'pending');delete r.plan.signing;
 r.plan.completed=[{index:0,hash:'0xabc'}];r.verification={verifiedAt:new Date().toISOString()};r.chainStatus='verified';r.activation={live:true,paidUntil:String(Math.floor(Date.now()/1000)+60)};
 assert.notEqual(publicationStatus(s,r).status,'complete');r.site={status:'published'};p.siteProductionId=r.id;assert.equal(publicationStatus(s,r).status,'complete');
 r.activation.paidUntil='1';assert.notEqual(publicationStatus(s,r).status,'complete');r.activation.paidUntil=String(Math.floor(Date.now()/1000)+60);
 p.siteProductionId='newer';assert.notEqual(publicationStatus(s,r).status,'complete');
});
test('independently pinned key validates old/new receipts, rejects tampering, substituted identity and revoked history',()=>{
 const {s,r,keys}=fixture(),registry=s.keyRegistry(),pin=registry.keys[0].fingerprint,receipt=s.receiptFor(r);
 assert.equal(verifyTrustedReceipt(receipt,registry,pin).verified,true);assert.equal(receipt.payload.keyId,registry.currentKeyId);
 const tampered=structuredClone(receipt);tampered.payload.manifestHash='tampered';assert.throws(()=>verifyTrustedReceipt(tampered,registry,pin),/签名/);
 const evil=pair();const forged={...receipt,publicKey:evil.publicKey,signature:sign(null,Buffer.from(JSON.stringify(receipt.payload)),evil.privateKey).toString('base64')};assert.throws(()=>verifyTrustedReceipt(forged,registry,pin),/不匹配/);
 const legacy=structuredClone(receipt);delete legacy.payload.keyId;legacy.signature=sign(null,Buffer.from(JSON.stringify(legacy.payload)),keys.privateKey).toString('base64');assert.equal(verifyTrustedReceipt(legacy,registry,pin).legacy,true);
 const rotated=keyRegistry(evil.publicKey,[{publicKey:keys.publicKey,status:'retired'}]);assert.equal(verifyTrustedReceipt(receipt,rotated,pin).status,'retired');
 rotated.keys[1].status='revoked';assert.throws(()=>verifyTrustedReceipt(receipt,rotated,pin),/撤销/);
 assert.throws(()=>verifyTrustedReceipt(receipt,registry,''),/独立确认/);
});

test('another in-flight release blocks new quotes and signing in the same project',()=>{
 const {s,p,r}=fixture();plan(s,p,r);const q=quoteStep(s,r,quoteInput);
 const other=s.createRelease(p.id,artifact());other.plan={signing:{index:0}};
 assert.throws(()=>quoteStep(s,r,quoteInput),/另一个版本/);
 assert.throws(()=>beginSigning(s,r,{index:0,quoteId:q.id},1100),/另一个版本/);
 delete other.plan;assert.equal(beginSigning(s,r,{index:0,quoteId:q.id},1100).recorded,true);
});

test('signed receipt is an immutable snapshot when live transaction and configuration records later change',()=>{
 const {s,r}=fixture();approve(s,r);const receipt=r.receipt,registry=s.keyRegistry(),pin=registry.keys[0].fingerprint;
 r.transactions.push({hash:'later-transaction'});r.source.type='changed-after-signing';r.approvedConfiguration.environment.push({key:'LATER'});
 assert.equal(receipt.payload.transactions.length,0);assert.notEqual(receipt.payload.source.type,r.source.type);assert.equal(receipt.payload.approvedConfiguration.environment.length,0);
 assert.equal(verifyTrustedReceipt(receipt,registry,pin).verified,true);
});
