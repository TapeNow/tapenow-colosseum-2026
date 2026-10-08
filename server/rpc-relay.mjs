import {FetchRequest} from 'ethers';
import {countRpc} from './resource-meter.mjs';
import {CHAINS} from './chains.mjs';

// Only server-side configuration can enable this transport. Public chain metadata
// retains public URLs; neither relay credentials nor internal URLs reach clients.
let config;
export function configureRpcRelay(value){
 if(!value?.url||!value?.token){config=undefined;return;}
 const url=new URL(value.url);
 if(url.protocol!=='https:'||url.username||url.password||!/^[A-Za-z0-9_-]{43,128}$/.test(value.token))throw Error('Invalid RPC relay configuration');
 config={origin:url.origin,token:value.token};
}
export function rpcDestination(url){
 if(!config)return {url,headers:{}};
 for(const chain of Object.values(CHAINS)){
  const index=chain.rpcUrls.indexOf(url);
  if(index!==-1)return {url:config.origin+'/rpc/'+chain.chainId+'/'+index,headers:{Authorization:'Bearer '+config.token}};
 }
 throw Error('RPC endpoint is not pinned');
}
export function rpcRequest(url){const target=rpcDestination(url),request=new FetchRequest(target.url);request.setThrottleParams({maxAttempts:2,slotInterval:200});request.preflightFunc=async req=>{countRpc(req.body);return req;};for(const [k,v]of Object.entries(target.headers))request.setHeader(k,v);return request;}
export function rpcFetch(url,options){const target=rpcDestination(url);countRpc(options?.body);return fetch(target.url,{...options,headers:{...options?.headers,...target.headers}});}

const METHODS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getStorageAt','eth_call','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_getBalance','eth_getCode','eth_feeHistory','eth_getTransactionCount']);
const reject=status=>Object.assign(Error('RPC request rejected'),{status});
export function createRpcPacer({clock=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const next=new Map();
 return async url=>{
  // Shared public endpoints have finite capacity even for read-only sites.
  // Pace globally at the relay so concurrent requests cannot multiply that burst.
  const now=clock(),at=Math.max(now,next.get(url)||0),delay=at-now;
  if(delay>6000)throw Object.assign(reject(429),{source:'pacing'});
  next.set(url,at+(url==='https://base.gateway.tenderly.co'?500:180));
  if(delay)await wait(delay);
 };
}
const pace=createRpcPacer();
export async function relayReadRpc(path,input,{fetcher=fetch}={}){
 const match=/^\/rpc\/(56|196|8453)\/([01])$/.exec(path);
 if(!match||!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!['jsonrpc','id','method','params'].includes(k))||input.jsonrpc!=='2.0'||!METHODS.has(input.method)||!Array.isArray(input.params)||input.params.length>5||!((Number.isSafeInteger(input.id)&&input.id>=0)||(typeof input.id==='string'&&input.id.length<=100)))throw reject(400);
 // Separate operator URLs stay independent; the relay never broadcasts, follows
 // redirects, accepts a caller URL, or passes its authentication upstream.
 const url=CHAINS[match[1]].rpcUrls[Number(match[2])];if(fetcher===fetch)await pace(url);
 const response=await fetcher(url,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Object.assign(reject(response.status===429?429:502),{source:'upstream',upstreamStatus:response.status});
 const reader=response.body?.getReader();if(!reader)throw reject(502);const parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw reject(502);parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 const result=JSON.parse(Buffer.concat(parts).toString());
 if(!result||Array.isArray(result)||result.jsonrpc!=='2.0'||result.id!==input.id||(result.result===undefined&&!result.error))throw reject(502);
 return result;
}
