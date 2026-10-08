import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGatewayClient,readGatewayManifest,verifyGatewayFile} from '../public/sdk/tapenow-gateway.mjs';
test('SDK mutations preserve session, CSRF, workspace and domain identifier; no wallet signing is hidden',async()=>{
 const calls=[],client=createGatewayClient({origin:'https://app.test',csrf:'csrf',workspace:'workspace',fetcher:async(url,opts)=>{calls.push({url:String(url),...opts});return Response.json({ok:true});}});
 await client.prepareDomain('dom-123456abcdef');await client.publish('d-123456abcdef',{challengeId:'q',signature:'signed'});
 assert.ok(calls[0].url.endsWith('/domains/dom-123456abcdef/gateway-prepare'));assert.equal(calls[0].headers['X-Deweb-Token'],'csrf');assert.equal(calls[0].headers['X-TapeNow-Workspace'],'workspace');assert.equal(calls[0].credentials,'include');assert.equal(calls[0].redirect,'error');assert.equal(JSON.parse(calls[1].body).signature,'signed');
 assert.throws(()=>client.prepareDomain('../a'));await assert.rejects(createGatewayClient({origin:'https://app.test'}).check('p-123456abcdef'),/CSRF/);
 assert.throws(()=>createGatewayClient({origin:'ftp://localhost'}));
});
test('SDK verifies actual bytes and keeps unusual file names on the selected gateway origin',async()=>{
 const body=Buffer.from('verified'),file={path:'assets/file.txt',bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')};let url;
 const fetcher=async value=>{url=String(value);return new Response(body);};assert.equal((await verifyGatewayFile('https://site.test',file,{fetcher})).verified,true);
 await assert.rejects(verifyGatewayFile('https://site.test',{...file,sha256:'0'.repeat(64)},{fetcher}),/integrity/);
 await assert.rejects(verifyGatewayFile('https://site.test',{...file,path:'../secret'},{fetcher}),/Unsafe/);
 await verifyGatewayFile('https://site.test',{...file,path:'https:evil.test/file'},{fetcher});assert.equal(new URL(url).origin,'https://site.test');
 await assert.rejects(readGatewayManifest('http://site.test'),/HTTPS/);
});
