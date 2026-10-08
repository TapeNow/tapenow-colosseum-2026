import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,generateKeyPairSync} from 'node:crypto';
import {createMemoryStore,parseFiles} from '../server/core.mjs';
import {initializeBetaPolicy,betaCapabilities,assertBetaAction,isRecoveryAction} from '../server/beta-policy.mjs';
import {startNativeAccess,confirmNativeAccess} from '../server/native-access.mjs';
import {publicationStatus} from '../server/release-policy.mjs';
import {reservePreview} from '../server/preview-quota.mjs';
import {beginOperation,finishOperation,pruneOperationalData} from '../server/operation-policy.mjs';
import {approve} from './approval-fixture.mjs';
import {createPrivatePreview} from '../cloud/private-preview.mjs';
const fixture=()=>{const keys=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}),s=createMemoryStore({vaultKey:randomBytes(32),...keys}),p=s.createProject('Beta A');p.chain={chainId:196,cpuIndex:'231',tokenId:'12'};const r=s.createRelease(p.id,parseFiles({files:[{path:'index.html',base64:Buffer.from('native').toString('base64')}]}));return {s,p,r};};
test('A policy preserves existing projects and refuses body-based upgrades',()=>{
 const {s,p}=fixture();p.siteProductionId='d-old';initializeBetaPolicy(s);const other=s.createProject('New project');initializeBetaPolicy(s);
 const c=betaCapabilities({BETA_PHASE:'A'}, {id:'external'},s);assert.equal(c.phase,'A');
 assert.doesNotThrow(()=>assertBetaAction(c,p.id,'POST','/api/releases/d-id/publish-site'));
 for(const path of ['/api/releases/d-id/publish-site','/api/releases/d-id/gateway/prepare','/api/domains/dom-id/gateway-prepare','/api/releases/d-id/preview'])assert.throws(()=>assertBetaAction(c,other.id,'POST',path,{platformHosting:true}),{status:403});
 assert.doesNotThrow(()=>assertBetaAction(c,other.id,'POST','/api/releases/d-id/cloudflare',{production:true}));
 assert.equal(betaCapabilities({BETA_PHASE:'A',OPERATOR_EMAILS:'operator@test'}, {id:'owner'},s).platformHosting,false);
});
test('quota exhaustion keeps recovery available and monthly preview quotas remain bounded',()=>{
 for(const path of ['chain/pending','chain/confirm','chain/costs','chain/rejected','private-preview/revoke'])assert.ok(isRecoveryAction('POST','/api/releases/d-id/'+path));
 assert.equal(isRecoveryAction('POST','/api/releases/d-id/chain/intent'),false);
 let q=reservePreview({month:'2026-09',requests:9999,bytes:1},{bytes:9},Date.UTC(2026,8,29));assert.ok(q.allowed);
 assert.equal(reservePreview(q.usage,{bytes:0},Date.UTC(2026,8,29)).allowed,false);
 assert.ok(reservePreview(q.usage,{bytes:0},Date.UTC(2026,9,1)).allowed);
});
test('reimporting identical files cannot renew the seven-day preview lifetime',async()=>{
 const {s,p,r}=fixture(),duplicate=s.createRelease(p.id,parseFiles({files:r.files}));
 s.state.previewLifetimes={[r.manifestHash]:new Date(Date.now()-8*86400000).toISOString()};
 let writes=0;const env={BETA_PHASE:'A',SITE_DOMAIN:'test.example',SITE_DNS_READY:'true',ARTIFACTS:{get:async()=>null,put:async()=>{writes++;}}};
 await assert.rejects(()=>createPrivatePreview(env,s,{id:'external'},duplicate,{hours:1}),{status:429});assert.equal(writes,0);
});
test('A completion separates native observation from content proof and activation',()=>{
 const {s,p,r}=fixture();approve(s,r,'chain');r.plan={chainId:196,container:'0xabc',steps:[{}],completed:[{}]};r.chainStatus='verified';r.verification={verifiedAt:new Date().toISOString()};r.activation={live:true,paidUntil:String(Math.floor(Date.now()/1000)+3600)};
 assert.notEqual(publicationStatus(s,r).status,'complete');let q=startNativeAccess(s,r);
 assert.throws(()=>confirmNativeAccess(s,r,{checkId:q.checkId,opened:true}),/检查版本/);
 confirmNativeAccess(s,r,{checkId:q.checkId,opened:true,assetsLoaded:true,expectedVersion:true});
 assert.equal(publicationStatus(s,r).status,'complete');assert.equal(r.nativeAccess.scope,'user-browser-observation');assert.equal(p.siteProductionId,undefined);assert.equal(s.publicState().releases[0].workflow.status,'complete');
  r.activation.paidUntil='1';assert.notEqual(publicationStatus(s,r).status,'complete');
});
test('native observations cannot be replayed against newer readback results',()=>{
 const {s,r}=fixture();approve(s,r,'chain');r.chainStatus='verified';r.verification={verifiedAt:new Date().toISOString()};r.activation={live:true,paidUntil:String(Math.floor(Date.now()/1000)+3600)};
 const q=startNativeAccess(s,r);r.verification.block=123;
 assert.throws(()=>confirmNativeAccess(s,r,{checkId:q.checkId,opened:true,assetsLoaded:true,expectedVersion:true}),{status:409});
});
test('durable operation keys replay once and ambiguous crashes never silently retry',async()=>{
 const map=new Map(),storage={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),delete:async k=>map.delete(k),list:async()=>map};
 const input={actorId:'a',method:'POST',path:'/api/projects/p-1/sample',body:{version:1},key:'0123456789abcdef'};
 const op=await beginOperation(storage,input);await assert.rejects(()=>beginOperation(storage,input),{status:409});
 await finishOperation(storage,op,new Response(null,{status:200,headers:{'Content-Type':'application/json'}}),'{}');
 assert.equal((await beginOperation(storage,input)).replay.body,'{}');
 await assert.rejects(()=>beginOperation(storage,{...input,body:{version:2}}),{status:409});
 assert.equal((await beginOperation(storage,{...input,actorId:'b'})).replay,undefined);
});
test('maintenance prunes expired diagnostic records without deleting current work or publication state',async()=>{
 const time=Date.UTC(2026,8,29),map=new Map([['operation:old',{at:time-8*86400000}],['operation:current',{at:time}],['resources:old',{day:'2026-08-01'}],['resources:current',{day:'2026-09-29'}],['current',{owner:'preserve'}]]);
 const storage={list:async({prefix})=>new Map([...map].filter(([k])=>k.startsWith(prefix))),delete:async k=>map.delete(k)};
 assert.equal(await pruneOperationalData(storage,time),2);assert.ok(map.has('current'));assert.ok(map.has('operation:current'));assert.ok(map.has('resources:current'));
});
