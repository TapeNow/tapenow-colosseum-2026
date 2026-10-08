import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {chainFor,nativeUrl} from '../server/chains.mjs';
import {createMemoryStore,parseFiles} from '../server/core.mjs';
import {approveRelease,readiness,digest,recordExpense,budgetSummary} from '../server/release-policy.mjs';
import {quoteStep,beginSigning} from '../server/publication-budget.mjs';
import {receiptBaseFees} from '../server/base-fees.mjs';
function fixture(){const keys=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}),s=createMemoryStore({vaultKey:randomBytes(32),privateKey:keys.privateKey,publicKey:keys.publicKey}),p=s.createProject('Base acceptance');p.chain={chainId:8453,cpuIndex:'1',tokenId:'1'};const r=s.createRelease(p.id,parseFiles({files:[{path:'index.html',base64:Buffer.from('Base').toString('base64')}]}));return {s,p,r};}
test('Base identity differs from X Layer even for identical contract addresses; legacy remains196',()=>{assert.equal(chainFor().chainId,196);assert.equal(chainFor(8453).nativeSymbol,'ETH');assert.equal(nativeUrl({chainId:8453,cpuIndex:'3',tokenId:'2'}),'https://2-3-3.tapekit.org/');assert.notEqual(nativeUrl({chainId:196,cpuIndex:'3',tokenId:'2'}),nativeUrl({chainId:8453,cpuIndex:'3',tokenId:'2'}));});
test('Base approval requires variable fee acknowledgement, quote includes intrinsic reserve and expires in30s',()=>{
 const {s,p,r}=fixture(),input={digest:readiness(s,r).digest,intent:'chain',maxBudgetNative:'0.01',acknowledgeUnknown:true};
 assert.throws(()=>approveRelease(s,r,input),/Base/);approveRelease(s,r,{...input,acknowledgeVariableL1:true});
 r.plan={id:'plan-base',chainId:8453,manifestHash:r.manifestHash,targetDigest:digest(p.chain),from:'0x'+'1'.repeat(40),steps:[{kind:'open',to:chainFor(8453).opener,data:'0x1234',value:'10'}],completed:[]};
 const args={gas:21000n,gasPrice:10n,balance:10n**18n,at:1000};
 assert.throws(()=>quoteStep(s,r,args),/Base/);
 const q=quoteStep(s,r,{...args,l1FeeWei:1000n,operatorFeeWei:200n});
 assert.equal(q.expiresAt,31000);assert.equal(q.intrinsicReserveWei,'2400');assert.equal(BigInt(q.maximumWei),(21000n*13n/10n+20000n)*13n+10n+2400n);
 assert.throws(()=>beginSigning(s,r,{index:0,quoteId:q.id},31001),/过期/);
 r.budget.capWei='100';assert.throws(()=>quoteStep(s,r,{...args,l1FeeWei:1000n,operatorFeeWei:0n}),/预算/);
});
test('actual Base fee contains execution, L1 and operator fee; missing or wrong receipts never become zero',()=>{
 const receipt={hash:'0xabc',blockHash:'0xblock',gasUsed:21n,gasPrice:10n},raw={transactionHash:'0xabc',blockHash:'0xblock',l1Fee:'0x64'};
 const fees=receiptBaseFees(raw,receipt,5n);assert.equal(fees.gasWei,315n);
 for(const value of [{...raw,l1Fee:undefined},{...raw,blockHash:'0xwrong'},{...raw,transactionHash:'0xother'}])assert.throws(()=>receiptBaseFees(value,receipt,5n));
 const {r}=fixture();recordExpense(r,{hash:'0xabc',...fees,valueWei:'1000',success:true,kind:'open',block:1});assert.equal(budgetSummary(r).spentWei,'1315');assert.equal(r.expenses[0].feeBreakdown.l1Wei,'100');
});
