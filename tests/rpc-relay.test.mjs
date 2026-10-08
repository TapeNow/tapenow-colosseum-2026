import test from 'node:test';
import assert from 'node:assert/strict';
import {configureRpcRelay,rpcDestination,relayReadRpc,createRpcPacer} from '../server/rpc-relay.mjs';
import {createCheckerServer} from '../server/checker-http.mjs';
const request={jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]};
test('RPC burst reservations are shared per operator, bounded, and do not delay a peer',async()=>{
 let time=0;const waits=[],pace=createRpcPacer({clock:()=>time,wait:async ms=>waits.push(ms)});
 for(let i=0;i<13;i++)await pace('https://base.gateway.tenderly.co');assert.deepEqual(waits,Array.from({length:12},(_,i)=>(i+1)*500));
 await assert.rejects(pace('https://base.gateway.tenderly.co'),{status:429});await pace('https://base-mainnet.public.blastapi.io');assert.equal(waits.length,12);
 time=10000;await pace('https://base.gateway.tenderly.co');assert.equal(waits.length,12);
});
test('relay pins independent upstreams and never forwards authentication',async()=>{
 const urls=[];const fetcher=async(url,opts)=>{urls.push(url);assert.equal(opts.redirect,'manual');assert.equal(opts.headers.Authorization,undefined);return Response.json({jsonrpc:'2.0',id:1,result:'0x123'});};
 assert.equal((await relayReadRpc('/rpc/8453/0',request,{fetcher})).result,'0x123');
 await relayReadRpc('/rpc/8453/1',request,{fetcher});assert.notEqual(urls[0],urls[1]);
 for(const input of [[request],{...request,method:'eth_sendRawTransaction'},{...request,method:'personal_sign'},{...request,url:'https://attacker.test'},{...request,params:Array(6).fill('x')}])await assert.rejects(relayReadRpc('/rpc/8453/0',input,{fetcher}),{status:400});
 await assert.rejects(relayReadRpc('/rpc/1/0',request,{fetcher}),{status:400});assert.equal(urls.length,2);
});
test('relay rejects redirects, oversized responses and mismatched response ids',async()=>{
 for(const response of [new Response('',{status:302,headers:{Location:'http://localhost'}}),new Response('x'.repeat(2*1024*1024+1)),Response.json({jsonrpc:'2.0',id:2,result:'wrong'})])await assert.rejects(relayReadRpc('/rpc/196/0',request,{fetcher:async()=>response}),{status:502});
});
test('server transport hides credentials and refuses unpinned targets',()=>{
 configureRpcRelay({url:'https://checker.example.test/check',token:'x'.repeat(43)});
 try{assert.deepEqual(rpcDestination('https://base.gateway.tenderly.co'),{url:'https://checker.example.test/rpc/8453/0',headers:{Authorization:'Bearer '+'x'.repeat(43)}});assert.throws(()=>rpcDestination('https://attacker.test'));}finally{configureRpcRelay(null);}
 assert.deepEqual(rpcDestination('https://base.gateway.tenderly.co'),{url:'https://base.gateway.tenderly.co',headers:{}});
});
test('HTTP relay requires authentication, rejects broadcasting and retains separate checker quota',async t=>{
 const token='a'.repeat(43);let calls=0;
 const server=createCheckerServer({token,rateLimit:1,rpcRelay:(path,input)=>relayReadRpc(path,input,{fetcher:async()=>{calls++;return Response.json({jsonrpc:'2.0',id:1,result:'0x1'});}}),postgres:async()=>({status:'verified'})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const root='http://127.0.0.1:'+server.address().port;
 const call=(path,input,auth=token)=>fetch(root+path,{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(input)});
 assert.equal((await call('/rpc/8453/0',request,'bad')).status,401);
 assert.equal((await call('/rpc/8453/0',{...request,method:'eth_sendRawTransaction'})).status,400);
 for(let i=0;i<3;i++)assert.equal((await call('/rpc/8453/0',request)).status,200);
 assert.equal((await call('/rpc/8453/0',{...request,padding:'x'.repeat(82*1024)})).status,413);
 assert.equal((await call('/rpc/8453/0?url=https://attacker.test',request)).status,404);
 assert.equal((await call('/check',{kind:'postgres',input:{}})).status,200);assert.equal(calls,3);
});
