import test from 'node:test';
import assert from 'node:assert/strict';
import {chainFor,planChain,nativeName,nativeUrl} from '../server/chains.mjs';
import {registrySteps,stableReceipt,confirmTransaction} from '../server/chain.mjs';
import {decodeApprovedOperation} from '../server/wallet-transactions.mjs';
import {observeChain} from '../server/chain-observer.mjs';
import {assertPlanTarget} from '../server/publication-budget.mjs';
import {digest} from '../server/release-policy.mjs';
const wallet='0x1111111111111111111111111111111111111111';
test('legacy records default only to X Layer; BSC names and contracts stay separated',()=>{
 assert.equal(planChain({}).chainId,196); assert.equal(planChain({chainId:56}).nativeSymbol,'BNB');
 assert.throws(()=>chainFor(1));assert.equal(nativeName({chainId:56,tokenId:'2',cpuIndex:'865'}),'2.865.tape');
 assert.equal(nativeUrl({chainId:56,tokenId:'2',cpuIndex:'865'}),'https://2-865.tapekit.org/');
 assert.equal(nativeUrl({tokenId:'2',cpuIndex:'865'}),'https://2-2-865.tapekit.org/');
 for(const id of [56,196])assert.equal(registrySteps(wallet,[],chainFor(id))[0].to,chainFor(id).registry);
 assert.notEqual(chainFor(56).registry,chainFor(196).registry);
});
test('wallet transaction must match the immutable plan chain',()=>{
 const step={to:wallet,data:'0x1234',value:'0'},tx={chainId:56,from:wallet,...step};
 assert.equal(decodeApprovedOperation(tx,{status:1},wallet,step,56).success,true);
 assert.throws(()=>decodeApprovedOperation(tx,{status:1},wallet,step,196),/网络不匹配/);
});
test('target switch and legacy OKB budget cannot authorize BSC',()=>{
 const target={chainId:56,cpuIndex:'865',tokenId:'2'},r={id:'r',projectId:'p',manifestHash:'abc',budget:{capWei:'1'},plan:{chainId:56,targetDigest:digest(target),manifestHash:'abc'}};
 const store={project:()=>({chain:target}),state:{releases:[r]}};
 assert.throws(()=>assertPlanTarget(store,r),/预算网络/);r.budget.chainId=56;assert.doesNotThrow(()=>assertPlanTarget(store,r));
 r.plan.chainId=196;assert.throws(()=>assertPlanTarget(store,r),/链目标/);
});
function peer({chain=56,head=106,final=100,hash='0xabc',reorg=false}={}) {
 let reads=0;return {send:async()=> '0x'+chain.toString(16),getTransactionReceipt:async()=>({blockNumber:100,blockHash:hash,status:1}),getBlockNumber:async()=>head,getBlock:async tag=>typeof tag==='string'?{number:final}:{hash:reorg&&++reads>1?'0xchanged':hash}};
}
const receipt={blockNumber:100,blockHash:'0xabc',status:1};
test('dual RPC confirmation requires depth, finality and stable canonical hash',async()=>{
 await stableReceipt([peer(),peer()],chainFor(56),'0xtx',receipt);
 for(const opts of [{chain:196},{head:105},{final:99},{hash:'0xother'},{reorg:true}])await assert.rejects(stableReceipt([peer(),peer(opts)],chainFor(56),'0xtx',receipt));
});
test('observer chooses both RPC URLs using requested chain and rejects wrong chain',async()=>{
 for(const id of [56,196]){
  const urls=[];const result=await observeChain({chainId:id,cpuIndex:'865',tokenId:'2'},{fetcher:async(url)=>{urls.push(url);return {ok:true,json:async()=>({result:'0x1'})};}});
  assert.equal(result.status,'unverified');assert.equal(result.chainId,id);assert.deepEqual(urls,[...chainFor(id).rpcUrls]);assert.match(result.error,/网络不匹配/);
 }
});
import {Interface} from 'ethers';
import {sha} from '../server/core.mjs';
import {readVerifiedArtifact} from '../server/chain-observer.mjs';
const iface=new Interface(['function cpuAt(uint256) view returns(address)','function accountOf(address,uint256) view returns(address)','function isOpened(address,uint256) view returns(bool)','function pathCount(address) view returns(uint256)','function pathsRange(address,uint256,uint256) view returns(string[])','function fallbackPath(address) view returns(string)','function fileInfo(address,string) view returns(uint32,string,bytes32,uint40,uint256)','function readRange(address,string,uint256,uint256) view returns(bytes)','function isLive(string,address) view returns(bool)','function containerPaidUntil(address) view returns(uint256)']);
function observerFixture(id,{reorg=false}={}) {
 const bytes=Buffer.from('hello'),chain=chainFor(id);let blockReads=0;
 return async(url,opts)=>{
  const {method,params}=JSON.parse(opts.body);let result;
  if(method==='eth_chainId')result='0x'+id.toString(16);
  if(method==='eth_blockNumber')result='0x70';
  if(method==='eth_getBlockByNumber')result={hash:reorg&&++blockReads>2?'0xchanged':'0xstable'};
  if(method==='eth_getStorageAt'){const key=params[0]===chain.registry?'registry':'binding';result='0x'+'0'.repeat(24)+chain.implementations[key].slice(2);}
  if(method==='eth_call'){
   const call=iface.parseTransaction({data:params[0].data});
   const values={cpuAt:[wallet],accountOf:[wallet],isOpened:[true],pathCount:[1],pathsRange:[['index.html']],fallbackPath:['index.html'],fileInfo:[5,'text/html','0x'+sha(bytes),1,1],readRange:['0x'+bytes.toString('hex')],isLive:[true],containerPaidUntil:[2000000000]};
   result=iface.encodeFunctionResult(call.name,values[call.name]);
  }
  return {ok:true,json:async()=>({result})};
 };
}
test('both observers return correct native URL; content import verifies bytes; reorg rejects content',async()=>{
 for(const chainId of [56,196]){
  const target={chainId,cpuIndex:'865',tokenId:'2'};
  const metadata=await observeChain(target,{fetcher:observerFixture(chainId)});
  assert.equal(metadata.status,'verified');assert.equal(metadata.nativeUrl,nativeUrl(target));assert.equal(metadata.files[0].base64,undefined);
  const archive=await readVerifiedArtifact(target,{fetcher:observerFixture(chainId)});
  assert.equal(Buffer.from(archive.files[0].base64,'base64').toString(),'hello');
  await assert.rejects(readVerifiedArtifact(target,{fetcher:observerFixture(chainId,{reorg:true})}),/区块哈希发生变化/);
 }
});

test('upstream receipt RPC denial returns retryable503 and preserves pending transaction',async()=>{
 const {createServer}=await import('node:http');const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const rpc=JSON.parse(body);res.setHeader('Content-Type','application/json');if(rpc.method==='eth_getTransactionReceipt'){res.statusCode=403;res.end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,error:{code:-32602,message:'Archive requires personal token'}}));return;}const chain=chainFor(56),result=rpc.method==='eth_chainId'?'0x38':rpc.method==='eth_getStorageAt'?'0x'+'0'.repeat(24)+chain.implementations[rpc.params[0].toLowerCase()===chain.registry?'registry':'binding'].slice(2):null;res.end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const hash='0x'+'1'.repeat(64),pending={hash,index:0},release={plan:{chainId:56,steps:[{kind:'open'}],completed:[],pending},transactions:[]};let writes=0;
 try{await assert.rejects(confirmTransaction({state:{releases:[release]},save:()=>writes++},release,0,hash,'http://127.0.0.1:'+server.address().port),e=>e.status===503&&e.message.includes('不要重复签署')&&!e.message.includes('personal token'));assert.equal(release.plan.pending,pending);assert.equal(release.plan.completed.length,0);assert.equal(writes,0);}finally{await new Promise(resolve=>server.close(resolve));}
});
