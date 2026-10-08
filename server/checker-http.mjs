// Private Node-only connectivity bridge. Never expose a generic network/query proxy.
import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {checkPostgres,checkBusinessApi} from './postgres.mjs';
import {verifyDomainFiles,resolveDomainIPv4} from './ecosystem.mjs';
import {normalizeSiteFiles,normalizeSiteHostname,siteManifestHash} from './site-checker.mjs';
import {relayReadRpc} from './rpc-relay.mjs';
const LIMIT=24*1024,hash=value=>createHash('sha256').update(value).digest();
function error(status){return Object.assign(Error('Request rejected'),{status});}
function body(req,limit=LIMIT){return new Promise((resolve,reject)=>{
 let length=0,parts=[],done=false;
 const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);req.removeListener('data',data);req.removeListener('end',end);req.removeListener('error',failed);req.removeListener('aborted',failed);parts=[];if(err){req.resume();reject(err);}else resolve(value);};
 const data=chunk=>{length+=chunk.length;if(length>limit)return finish(error(413));parts.push(chunk);};
 const end=()=>{try{finish(null,JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{finish(error(400));}};
 const failed=()=>finish(error(400));const timer=setTimeout(()=>finish(error(408)),3000);
 req.on('data',data);req.once('end',end);req.once('error',failed);req.once('aborted',failed);
});}
const fields=['status','tls','readOnly','roleFlags','connectionPolicy','checkedAt','scope','httpStatus'];
export function createCheckerServer({token,postgres=checkPostgres,businessApi=checkBusinessApi,clock=Date.now,rateLimit=30,siteVerifier=verifyDomainFiles,rpcRelay=relayReadRpc,onDiagnostic=()=>{}}={}){
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(token))throw Error('Checker token must be a high-entropy base64url secret');
 const expected=hash('Bearer '+token);let active=0,windowStart=clock(),count=0,siteCount=0,rpcActive=0,rpcCount=0;
 const server=createServer({maxHeaderSize:4096},async(req,res)=>{
  const respond=(status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(status>=400?{Connection:'close'}:{}),...(status===429?{'Retry-After':'60'}:{})});res.end(JSON.stringify(value));};
  if(req.url==='/health'&&req.method==='GET')return respond(200,{ok:true});
  const site=req.url==='/verify-site',rpc=/^\/rpc\/(56|196|8453)\/[01]$/.test(req.url),limit=rpc?80*1024:site?512*1024:LIMIT;
  if((!rpc&&!['/check','/verify-site'].includes(req.url))||req.method!=='POST')return respond(404,{error:'Not found'});
  if(!timingSafeEqual(hash(req.headers.authorization||''),expected))return respond(401,{error:'Unauthorized'});
  if(clock()-windowStart>=60000){windowStart=clock();count=0;siteCount=0;rpcCount=0;}
  if(rpc?(++rpcCount>600||rpcActive>=24):(++count>rateLimit||(site&&++siteCount>4)||active>=2)){if(rpc)onDiagnostic({service:'rpc-relay',reason:'capacity',active:rpcActive,count:rpcCount});return respond(429,{error:'Checker busy'});}
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return respond(415,{error:'JSON required'});
  if(Number(req.headers['content-length'])>limit)return respond(413,{error:'Request too large'});
  if(rpc)rpcActive++;else active++;
  try{
   const input=await body(req,limit);
   if(rpc)return respond(200,await rpcRelay(req.url,input));
   if(site){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['hostname','files'].includes(k)))throw error(400);
    let files,name;try{files=normalizeSiteFiles(input.files);name=normalizeSiteHostname(input.hostname);}catch{throw error(400);}
    const sockets=new Set(),deadline=Date.now()+55000;let timer;
    try{
     const tls=await import('node:tls');
     const report=await Promise.race([siteVerifier(name,files,{resolveHost:n=>resolveDomainIPv4(n,{fetcher:(url,opts)=>fetch(url,{...opts,signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))})}),connect:(opts,ready)=>{if(Date.now()>=deadline)throw error(408);const socket=tls.connect(opts,ready);sockets.add(socket);socket.once('close',()=>sockets.delete(socket));return socket;},timeoutMs:8000}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(error(408)),Math.max(1,deadline-Date.now()));})]);
     if(report?.verified!==true)throw error(502);
     return respond(200,{status:'verified',verified:true,hostname:name,manifestHash:siteManifestHash(files),files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),checkedAt:new Date().toISOString(),scope:'private-node-checker'});
    }finally{clearTimeout(timer);for(const socket of sockets)socket.destroy();}
   }
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['kind','input'].includes(k))||!['postgres','business-api'].includes(input.kind)||!input.input||typeof input.input!=='object'||Array.isArray(input.input))throw error(400);
   if(input.kind==='business-api'&&(Object.keys(input.input).some(k=>k!=='url')||typeof input.input.url!=='string'))throw error(400);
   const report=input.kind==='postgres'?await postgres(input.input,{runtime:'node'}):await businessApi(input.input.url,{runtime:'node'});
   const safe=Object.fromEntries(fields.filter(k=>report?.[k]!==undefined&&['string','boolean','number'].includes(typeof report[k])).map(k=>[k,typeof report[k]==='string'?report[k].slice(0,1000):report[k]]));
   if(safe.status!=='verified')throw error(502);
   respond(200,safe);
  }catch(e){const status=[400,408,409,413,429].includes(e.status)?e.status:502;if(rpc)onDiagnostic({service:'rpc-relay',path:req.url,status,source:e.source||'transport',upstreamStatus:e.upstreamStatus});respond(status,{error:status===413?'Request too large':'Connection check failed'});}
  finally{if(rpc)rpcActive--;else active--;}
 });
 server.headersTimeout=5000;server.requestTimeout=15000;server.keepAliveTimeout=1000;server.maxRequestsPerSocket=20;
 return server;
}
export async function startChecker(file){
 const stat=await fs.stat(file);if((stat.mode&0o077)!==0)throw Error('Checker configuration must be private');
 const config=JSON.parse(await fs.readFile(file,'utf8')),host=config.host||'127.0.0.1',port=config.port||18764;
 if(!['127.0.0.1','::1'].includes(host)||!Number.isInteger(port)||port<1024||port>65535)throw Error('Checker must bind loopback only');
 const server=createCheckerServer({token:config.token,onDiagnostic:event=>console.warn(JSON.stringify(event))});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 return server;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 startChecker(process.argv[2]).then(server=>{console.log(JSON.stringify({service:'tapenow-checker',listening:'loopback'}));const stop=()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),15000).unref();};process.on('SIGTERM',stop);process.on('SIGINT',stop);}).catch(()=>{console.error('Checker startup failed');process.exitCode=1;});
}
