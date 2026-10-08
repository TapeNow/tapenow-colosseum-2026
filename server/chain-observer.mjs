import {Interface,getAddress} from 'ethers';
import {rpcFetch} from './rpc-relay.mjs';
import {chainFor,nativeName,nativeUrl,IMPLEMENTATION_SLOT} from './chains.mjs';
import {demand,sha,safePath,MAX_BYTES} from './core.mjs';

const factory=new Interface(['function cpuAt(uint256) view returns(address)']);
const opener=new Interface(['function accountOf(address,uint256) view returns(address)','function isOpened(address,uint256) view returns(bool)']);
const registry=new Interface(['function pathCount(address) view returns(uint256)','function pathsRange(address,uint256,uint256) view returns(string[])','function fallbackPath(address) view returns(string)','function fileInfo(address,string) view returns(uint32,string,bytes32,uint40,uint256)','function readRange(address,string,uint256,uint256) view returns(bytes)']);
const binding=new Interface(['function isLive(string,address) view returns(bool)','function containerPaidUntil(address) view returns(uint256)']);
export async function observeChain(target,{fetcher=rpcFetch,expected,previous,time=Date.now(),maxCalls=900,includeContent=false}={}) {
  demand(/^\d{1,20}$/.test(String(target.cpuIndex))&&/^\d{1,20}$/.test(String(target.tokenId)),'请先填写处理器与芯片编号',409);
  const chain=chainFor(target.chainId??196),rpcUrls=chain.rpcUrls;
  let calls=0;const started=Date.now();
  async function rpc(index,method,params) {
    demand(++calls<=maxCalls&&Date.now()-started<55000,'读取超过单次资源限制，请分批检查较大的站点',409);
    const response=await fetcher(rpcUrls[index],{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:calls,method,params}),signal:AbortSignal.timeout(12000)});
    demand(response.ok,response.status===429?'RPC 限流，请稍后重试':'RPC 暂时无法访问',503);
    const data=await response.json();demand(!data.error&&data.result!==undefined,'RPC 未返回完整结果',503);return data.result;
  }
  async function same(method,params){const values=await Promise.all([rpc(0,method,params),rpc(1,method,params)]);demand(JSON.stringify(values[0]).toLowerCase()===JSON.stringify(values[1]).toLowerCase(),'两个 RPC 的结果不一致，停止核验',409);return values[0];}
  try {
    demand(BigInt(await same('eth_chainId',[]))===BigInt(chain.chainId),'RPC 网络不匹配',409);
    const heads=await Promise.all([rpc(0,'eth_blockNumber',[]),rpc(1,'eth_blockNumber',[])]);
    const blockNumber=Math.min(...heads.map(n=>Number(BigInt(n))))-6;demand(Number.isSafeInteger(blockNumber)&&blockNumber>0,'RPC 区块高度无效',503);
    const block='0x'+blockNumber.toString(16);
    const hashes=await Promise.all([0,1].map(async i=>(await rpc(i,'eth_getBlockByNumber',[block,false]))?.hash));
    demand(hashes[0]&&hashes[0]===hashes[1],'两个 RPC 的区块哈希不一致',409);
    for(const key of ['registry','binding'])demand(('0x'+(await same('eth_getStorageAt',[chain[key],IMPLEMENTATION_SLOT,block])).slice(-40)).toLowerCase()===chain.implementations[key],'上游合约实现已变更，需要重新核查',409);
    const call=async(address,iface,name,args)=>(iface.decodeFunctionResult(name,await same('eth_call',[{to:address,data:iface.encodeFunctionData(name,args)},block])));
    const [cpu]=await call(chain.factory,factory,'cpuAt',[target.cpuIndex]);
    const [container]=await call(chain.opener,opener,'accountOf',[cpu,target.tokenId]);
    const [opened]=await call(chain.opener,opener,'isOpened',[cpu,target.tokenId]);
    demand(opened,'芯片尚未开通容器',409);
    const [count]=await call(chain.registry,registry,'pathCount',[container]);demand(count>0n&&count<=500n,'文件为空或超过 500 个文件的核验上限',409);
    const [paths]=await call(chain.registry,registry,'pathsRange',[container,0,count]);
    demand(paths.length===Number(count)&&new Set(paths).size===paths.length,'链上目录不完整或存在重复路径',409);paths.forEach(safePath);
    const files=[];let bytes=0;
    for(const path of paths) {
      const [size,mime,hash,updatedAt,chunks]=await call(chain.registry,registry,'fileInfo',[container,path]);
      bytes+=Number(size);demand(bytes<=MAX_BYTES,'站点超过 10 MiB 的单次核验上限',409);
      const buffers=[];
      for(let offset=0;offset<Number(size);offset+=24000){const [data]=await call(chain.registry,registry,'readRange',[container,path,offset,Math.min(24000,Number(size)-offset)]);buffers.push(Buffer.from(data.slice(2),'hex'));}
      const data=Buffer.concat(buffers);demand(data.length===Number(size)&&'0x'+sha(data)===hash.toLowerCase(),'文件内容不符合链上声明的哈希：'+path,409);
      files.push({...(includeContent?{base64:data.toString('base64')} : {}),path,bytes:Number(size),sha256:sha(data),contentType:mime,updatedAt:String(updatedAt),chunks:Number(chunks)});
    }
    files.sort((a,b)=>a.path.localeCompare(b.path));
    const [fallback]=await call(chain.registry,registry,'fallbackPath',[container]);
    const name=nativeName(target),[live]=await call(chain.binding,binding,'isLive',[name,container]),[paidUntil]=await call(chain.binding,binding,'containerPaidUntil',[container]);
    const after=await Promise.all([0,1].map(async i=>(await rpc(i,'eth_getBlockByNumber',[block,false]))?.hash));
    demand(after.every(h=>h===hashes[0]),'核验期间区块哈希发生变化，请重试',409);
    const matches=expected?expected.length===files.length&&expected.every(f=>files.some(x=>x.path===f.path&&x.sha256===f.sha256&&x.bytes===f.bytes&&x.contentType===f.contentType)):null;
    const prior=previous?.files||[];
    return {status:matches===false?'different':'verified',checkedAt:new Date(time).toISOString(),adapter:'TapeKit / '+chain.name,chainId:chain.chainId,blockNumber,blockHash:hashes[0],rpcUrls,cpu:getAddress(cpu),container:getAddress(container),files,bytes,fallback,live,paidUntil:new Date(Number(paidUntil)*1000).toISOString(),expectedMatch:matches,changes:previous?{added:files.filter(f=>!prior.some(x=>x.path===f.path)).map(f=>f.path),removed:prior.filter(f=>!files.some(x=>x.path===f.path)).map(f=>f.path),modified:files.filter(f=>prior.some(x=>x.path===f.path&&x.sha256!==f.sha256)).map(f=>f.path)}:null,calls,nativeUrl:nativeUrl(target),scope:'两个独立 RPC 在同一历史区块的字节与哈希核验；不等于网页可访问性或永久最终性，不发送交易'};
  }catch(e){return {status:e.status===503?'unavailable':'unverified',checkedAt:new Date(time).toISOString(),adapter:'TapeKit / '+chain.name,chainId:chain.chainId,rpcUrls,calls,error:e.status?e.message:'链上读取未完成，请稍后再试',files:[],scope:'本次没有获得完整核验结论；旧的成功记录不能代表当前结果'};}
}

// Content is returned only after the exact same bounded dual-RPC verification.
export async function readVerifiedArtifact(target,options={}) {
  const result=await observeChain(target,{...options,includeContent:true});
  demand(result.status==='verified',result.error||'链上产物核验未通过',409);
  return result;
}
