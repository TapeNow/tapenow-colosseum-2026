import {Contract,JsonRpcProvider,getAddress} from 'ethers';
import {rpcRequest} from './rpc-relay.mjs';
import {readVerifiedArtifact} from './chain-observer.mjs';
import {demand,sha} from './core.mjs';
import {chainFor,nativeName,nativeUrl,IMPLEMENTATION_SLOT} from './chains.mjs';
export const HEALTH_URLS=Object.freeze(['https://tapeout.work/api/v1/deweb','https://tapeout.work/api/v1/data-health','https://tapeout.work/api/v1/ecosystem/health']);
export function ecosystemLinks(target){const c=chainFor(target.chainId??196);return {chainId:c.chainId,nativeSymbol:c.nativeSymbol,nativeName:/^\d+$/.test(target.tokenId)&&/^\d+$/.test(target.cpuIndex)?nativeName(target):null,nativeUrl:/^\d+$/.test(target.tokenId)&&/^\d+$/.test(target.cpuIndex)?nativeUrl(target):null,oneClick:'https://id.tapeout.link/',explorer:'https://tapeoutexplorer.com/deweb/index.html',tapeWeb:'https://web.tapeout.link/',hashPort:'https://hashport.ai/app',fees:{transactionGas:{payer:'签署钱包',currency:c.nativeSymbol,source:'签署前链上 gas 估价'},containerOpen:{payer:'签署钱包',source:'Opener.FEE() 实时读取'},domainBinding:{payer:'签署钱包',source:'DomainBinding.monthlyFee() 实时读取；不假设免费'}}};}
export function hostname(value){demand(typeof value==='string'&&value.length<=253&&value===value.trim().toLowerCase()&&/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)&&!value.endsWith('.localhost'),'请输入有效公共域名');return value;}
export function domainDns(name,container){return [{type:'TXT',name:'_tapeout.'+hostname(name),content:getAddress(container),proxied:false},{type:'CNAME',name:hostname(name),content:'cname.hashport.org',proxied:false}];}
const providerFor=c=>{const req=rpcRequest(c.rpc);req.timeout=12000;return new JsonRpcProvider(req,c.chainId,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});};
export async function resolveContainer(target,wallet,{providerFactory=providerFor}={}){
 const chain=chainFor(target.chainId??196);demand(/^\d{1,20}$/.test(String(target.cpuIndex))&&/^\d{1,20}$/.test(String(target.tokenId)),'处理器或芯片编号无效');
 const p=providerFactory(chain);try{
  demand(BigInt(await p.send('eth_chainId',[]))===BigInt(chain.chainId),'RPC 网络不匹配',409);
  for(const key of ['registry','binding'])demand(('0x'+(await p.getStorage(chain[key],IMPLEMENTATION_SLOT)).slice(-40)).toLowerCase()===chain.implementations[key],'上游合约实现发生变化',409);
  const cpu=await new Contract(chain.factory,['function cpuAt(uint256) view returns(address)'],p).cpuAt(target.cpuIndex);
  const opener=new Contract(chain.opener,['function accountOf(address,uint256) view returns(address)','function isOpened(address,uint256) view returns(bool)','function FEE() view returns(uint256)'],p);
  const [container,opened,owner,fee]=await Promise.all([opener.accountOf(cpu,target.tokenId),opener.isOpened(cpu,target.tokenId),new Contract(cpu,['function ownerOf(uint256) view returns(address)'],p).ownerOf(target.tokenId),opener.FEE()]);
  return {...ecosystemLinks(target),cpu:getAddress(cpu),container:getAddress(container),owner:getAddress(owner),opened,walletMatch:wallet?getAddress(wallet)===getAddress(owner):null,openFeeWei:String(fee),ownershipGranted:false};
 }finally{p.destroy();}
}
async function boundedJson(url,{fetcher=fetch,maxBytes=1048576,accept='application/json'}={}){
 const r=await fetcher(url,{redirect:'manual',headers:{Accept:accept},signal:AbortSignal.timeout(8000)});demand(r.ok,'公共服务暂不可用',503);
 const reader=r.body?.getReader();demand(reader,'公共服务响应不完整',503);let bytes=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;demand(bytes<=maxBytes,'公共服务响应过大',503);chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 return JSON.parse(Buffer.concat(chunks).toString());
}
const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.includes('.')&&!/^\d+(?:\.\d+){3}$/.test(u.hostname)?u.href:null;}catch{return null;}};
const text=value=>typeof value==='string'?value.slice(0,200):null;
export function summarizeHealth(data){const counts={};for(const [k,v]of Object.entries(data?.counts||{}).slice(0,30))if(/^[a-z_]{1,40}$/.test(k)&&Number.isSafeInteger(v)&&v>=0)counts[k]=v;
 return {status:text(data?.status)||'unknown',checkedAt:text(data?.checked_at||data?.updated_at),counts,sites:(Array.isArray(data?.tools)?data.tools:Array.isArray(data?.sites)?data.sites:[]).slice(0,100).map(x=>({label:text(x.title_zh||x.title_en||x.name||x.hostname),url:safeUrl(x.url),status:text(x.status)})).filter(x=>x.url)};}
export function createHealthReader({fetcher=fetch,clock=Date.now}={}){
 const cache=new Map(),inflight=new Map();
 async function read(url){const now=clock(),old=cache.get(url);if(old&&now<old.nextAt)return old.result;if(inflight.has(url))return inflight.get(url);
 const task=(async()=>{let result;try{result={source:url,availability:'available',stale:false,fetchedAt:new Date(now).toISOString(),...summarizeHealth(await boundedJson(url,{fetcher}))};cache.set(url,{result,nextAt:now+600000,failures:0});}catch{const failures=Math.min(6,(old?.failures||0)+1);result={...(old?.result||{}),source:url,availability:'unavailable',stale:!!old?.result.fetchedAt,lastAttemptAt:new Date(now).toISOString(),error:'公共数据暂不可用；旧数据不代表当前状态'};cache.set(url,{result,nextAt:now+Math.min(600000,30000*2**(failures-1)),failures});}return result;})().finally(()=>inflight.delete(url));inflight.set(url,task);return task;}
 return async()=>({sources:await Promise.all(HEALTH_URLS.map(read)),scope:'公共目录与服务自报健康摘要；不代表已验证部署或所有权'});
}
export async function verifyPublicDns(name,container,{fetcher=fetch}={}){
 const records=domainDns(name,container),results=await Promise.all(records.map(async record=>{const u=new URL('https://cloudflare-dns.com/dns-query');u.searchParams.set('name',record.name);u.searchParams.set('type',record.type);const body=await boundedJson(u.href,{fetcher,maxBytes:65536,accept:'application/dns-json'});demand(body.Status===0,'DNS 查询未成功',409);return body.Answer||[];}));
 const txt=results[0].filter(x=>x.type===16).map(x=>String(x.data).replace(/"\s*"/g,'').replace(/^"|"$/g,''));
 const cname=results[1].filter(x=>x.type===5).map(x=>String(x.data).toLowerCase().replace(/\.$/,''));
 demand(txt.some(x=>x.toLowerCase()===container.toLowerCase())&&cname.includes('cname.hashport.org'),'公开 DNS 尚未匹配 HashPort TXT 与 CNAME',409);return {verified:true,records,checkedAt:new Date().toISOString()};
}

// Parse a bounded HTTP/1.1 response. Identity encoding only; framing ambiguity
// is rejected rather than guessed. Connection: close bounds collection lifetime.
export function decodeHttpFile(wire,expectedBytes) {
 const boundary=wire.indexOf('\r\n\r\n');demand(boundary>=0&&boundary<=16384,'HTTP 响应头无效',409);
 const lines=wire.subarray(0,boundary).toString('latin1').split('\r\n');demand(/^HTTP\/1\.[01] 200(?: |$)/.test(lines.shift()),'域名文件未返回200',409);
 const headers=new Map();for(const line of lines){const m=/^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\r\n]*)$/.exec(line);demand(m,'HTTP 响应头无效',409);const key=m[1].toLowerCase();demand(!headers.has(key)||!['content-length','transfer-encoding','content-encoding'].includes(key),'HTTP 响应头重复',409);headers.set(key,m[2].trim());}
 const encoding=headers.get('content-encoding');demand(!encoding||encoding.toLowerCase()==='identity','域名文件编码不受支持',409);
 const transfer=headers.get('transfer-encoding'),length=headers.get('content-length'),body=wire.subarray(boundary+4);
 demand(!(transfer&&length),'HTTP 响应长度冲突',409);
 if(transfer){demand(transfer.toLowerCase()==='chunked','HTTP 分块编码无效',409);let pos=0,total=0;const chunks=[];
  for(let count=0;count<4096;count++){const end=body.indexOf('\r\n',pos);demand(end>=pos&&end-pos<=1024,'HTTP 分块头无效',409);const line=body.subarray(pos,end).toString('ascii');demand(/^[0-9a-fA-F]{1,12}(?:;[^\r\n]*)?$/.test(line),'HTTP 分块长度无效',409);const size=Number.parseInt(line.split(';')[0],16);pos=end+2;
   if(size===0){const trailer=body.subarray(pos);demand(trailer.length<=16384&&(trailer.equals(Buffer.from('\r\n'))||trailer.toString('latin1').endsWith('\r\n\r\n')),'HTTP 分块结尾无效',409);demand(total===expectedBytes,'域名文件大小不匹配',409);return Buffer.concat(chunks);}
   total+=size;demand(total<=expectedBytes&&pos+size+2<=body.length&&body.subarray(pos+size,pos+size+2).equals(Buffer.from('\r\n')),'HTTP 分块内容无效',409);chunks.push(body.subarray(pos,pos+size));pos+=size+2;
  }demand(false,'HTTP 分块数量超限',409);
 }
 if(length!==undefined)demand(/^\d+$/.test(length)&&Number(length)===expectedBytes,'域名文件大小不匹配',409);
 demand(body.length===expectedBytes,'域名文件大小不匹配',409);return body;
}
export async function resolveDomainIPv4(name,{fetcher=fetch}={}) {
 const {isPublicAddress}=await import('./postgres.mjs');const u=new URL('https://cloudflare-dns.com/dns-query');u.searchParams.set('name',hostname(name));u.searchParams.set('type','A');
 const data=await boundedJson(u.href,{fetcher,maxBytes:65536,accept:'application/dns-json'}),addresses=(data.Answer||[]).filter(r=>r.type===1).map(r=>r.data);
 demand(data.Status===0&&addresses.length>0&&addresses.length<=64&&addresses.every(isPublicAddress),'域名必须解析为允许的公开 IPv4',409);return addresses[0];
}
export async function readPinnedFile(name,path,address,expectedBytes,{connect,timeoutMs=8000}={}) {
 const tls=await import('node:tls');return new Promise((resolve,reject)=>{
  let socket,done=false,wireBytes=0;const chunks=[];const finish=(error,data)=>{if(done)return;done=true;clearTimeout(timer);socket?.destroy();error?reject(error):resolve(data);};
  const timer=setTimeout(()=>finish(Error('域名文件读取超时')),Math.min(12000,Math.max(1,timeoutMs)));
  try{socket=(connect||tls.connect)({host:address,port:443,servername:name,rejectUnauthorized:true,minVersion:'TLSv1.2'},()=>{
   if(done)return;if(socket.authorized!==true){finish(Error('域名 TLS 证书无效'));return;}
   socket.write('GET /'+path.split('/').map(encodeURIComponent).join('/')+' HTTP/1.1\r\nHost: '+name+'\r\nAccept-Encoding: identity\r\nConnection: close\r\nUser-Agent: TapeNow-Verification\r\n\r\n');
  });socket.on('error',e=>finish(e));socket.on('data',chunk=>{wireBytes+=chunk.length;if(wireBytes>Math.min(32*1024*1024,expectedBytes*8+32768)){finish(Error('域名响应大小超限'));return;}chunks.push(Buffer.from(chunk));});socket.on('end',()=>{try{finish(null,decodeHttpFile(Buffer.concat(chunks),expectedBytes));}catch(e){finish(e);}});socket.on('close',()=>{if(!done)finish(Error('域名响应中断'));});
  }catch(e){finish(e);}
 });
}
// A records are checked and selected explicitly; the actual TLS connection never
// resolves the hostname again, while SNI/certificate validation retain its identity.
export async function verifyDomainFiles(name,files,{resolveHost=resolveDomainIPv4,connect,timeoutMs}={}) {
 hostname(name);const address=await resolveHost(name),started=Date.now();let total=0;
 demand(files.length<=500,'文件数量超限');
 for(const file of files){demand(Date.now()-started<55000,'域名内容核验超时',409);total+=file.bytes;demand(total<=10*1024*1024,'内容核验超过10MiB',409);
  const data=await readPinnedFile(name,file.path,address,file.bytes,{connect,timeoutMs});
  demand(data.length===file.bytes&&sha(data)===file.sha256,'域名文件与批准版本不一致：'+file.path,409);
 }
 return {verified:true,files:files.length,bytes:total,checkedAt:new Date().toISOString()};
}

// The cloud server verifies chain bytes; custom-host HTTPS is checked separately
// by the current browser. Never infer gateway availability from on-chain success.
export async function verifyChainFiles(target,files,{reader=readVerifiedArtifact}={}) {
 const report=await reader(target,{expected:files});
 demand(report.status==='verified'&&report.expectedMatch===true&&report.chainId===target.chainId,'链上文件与批准版本不一致',409);
 return {verified:true,files:report.files.length,bytes:report.bytes,blockNumber:report.blockNumber,blockHash:report.blockHash,checkedAt:report.checkedAt,scope:'dual-rpc-chain-files',gatewayHttps:'unverified',hostnameHttps:'pending-current-browser'};
}
