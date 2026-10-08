import {rpcFetch} from './rpc-relay.mjs';
import {Interface,getAddress,verifyMessage} from 'ethers';
import {randomBytes} from 'node:crypto';
import {chainFor,nativeUrl,IMPLEMENTATION_SLOT} from './chains.mjs';
import {demand,sha,safePath,MAX_BYTES} from './core.mjs';
import {digest,approvalDigest,assertApproved} from './release-policy.mjs';

export const GATEWAY_SCHEMA='tapenow-gateway/v1';
export const GATEWAY_LEASE_MS=2*60*60*1000;
const iface=new Interface(['function cpuAt(uint256) view returns(address)','function accountOf(address,uint256) view returns(address)','function ownerOf(uint256) view returns(address)','function isOpened(address,uint256) view returns(bool)','function containerPaidUntil(address) view returns(uint256)']);
export function gatewayTarget(chain) {
  const chainId=chainFor(chain?.chainId??196).chainId;
  demand(/^\d{1,20}$/.test(String(chain?.cpuIndex))&&/^\d{1,20}$/.test(String(chain?.tokenId)),'请先设置处理器和芯片编号',409);
  return {chainId,cpuIndex:String(BigInt(chain.cpuIndex)),tokenId:String(BigInt(chain.tokenId))};
}
// No user-selectable RPC: both operators attest the same recent block.
export async function readGatewayIdentity(target,{fetcher=rpcFetch}={}) {
  target=gatewayTarget(target);const c=chainFor(target.chainId);let calls=0;
  const rpc=async(i,method,params)=>{
    const r=await fetcher(c.rpcUrls[i],{method:'POST',headers:{'Content-Type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000),body:JSON.stringify({jsonrpc:'2.0',id:++calls,method,params})});
    demand(r.ok,'网关读链服务暂不可用',503);const v=await r.json();demand(!v.error&&v.result!==undefined,'网关读链结果不完整',503);return v.result;
  };
  const same=async(method,params)=>{const v=await Promise.all([rpc(0,method,params),rpc(1,method,params)]),canonical=r=>method==='eth_getBlockByNumber'?r?.hash:r;demand(JSON.stringify(canonical(v[0]))?.toLowerCase()===JSON.stringify(canonical(v[1]))?.toLowerCase(),'两个 RPC 的核验结果不一致',409);return v[0];};
  demand(BigInt(await same('eth_chainId',[]))===BigInt(c.chainId),'RPC 网络不匹配',409);
  const heights=await Promise.all([rpc(0,'eth_blockNumber',[]),rpc(1,'eth_blockNumber',[])]),n=Math.min(...heights.map(h=>Number(BigInt(h))))-c.confirmations;
  demand(Number.isSafeInteger(n)&&n>0,'RPC 区块高度无效',503);const block='0x'+n.toString(16);
  const head=await same('eth_getBlockByNumber',[block,false]);demand(head?.hash,'RPC 区块不可用',503);
  for(const k of ['registry','binding'])demand(('0x'+(await same('eth_getStorageAt',[c[k],IMPLEMENTATION_SLOT,block])).slice(-40)).toLowerCase()===c.implementations[k],'上游合约实现发生变化',409);
  const call=async(to,name,args)=>iface.decodeFunctionResult(name,await same('eth_call',[{to,data:iface.encodeFunctionData(name,args)},block]))[0];
  const cpu=getAddress(await call(c.factory,'cpuAt',[target.cpuIndex]));
  const [container,owner,opened]=await Promise.all([call(c.opener,'accountOf',[cpu,target.tokenId]),call(cpu,'ownerOf',[target.tokenId]),call(c.opener,'isOpened',[cpu,target.tokenId])]);
  const paidUntil=Number(await call(c.binding,'containerPaidUntil',[container]))*1000;
  demand((await same('eth_getBlockByNumber',[block,false]))?.hash===head.hash,'核验期间区块发生变化',409);
  return {...target,cpu,container:getAddress(container),owner:getAddress(owner),opened,paidUntil,blockNumber:n,blockHash:head.hash,checkedAt:new Date().toISOString()};
}
export function gatewaySnapshot(report,target,release) {
  target=gatewayTarget(target);
  demand(report.status==='verified'&&report.chainId===target.chainId&&report.live===true&&Date.parse(report.paidUntil)>Date.now(),'链上文件或激活状态未通过核验',409);
  demand(Array.isArray(report.files)&&report.files.length>0&&report.files.length<=500,'网关文件清单无效',409);
  const files=report.files.map(f=>{safePath(f.path);const data=Buffer.from(f.base64||'','base64');demand(data.length===f.bytes&&sha(data)===f.sha256,'网关文件完整性检查失败',409);demand(typeof f.contentType==='string'&&f.contentType.length<=160&&/^[\w.+-]+\/[\w.+-]+(?:;[\w =.+-]+)?$/.test(f.contentType),'链上文件类型无效',409);return {path:f.path,bytes:f.bytes,sha256:f.sha256,contentType:f.contentType};}).sort((a,b)=>a.path.localeCompare(b.path));
  demand(new Set(files.map(f=>f.path)).size===files.length&&files.reduce((n,f)=>n+f.bytes,0)<=MAX_BYTES,'网关文件超过资源上限',409);
  demand(files.length===release.files.length&&files.every(f=>release.files.some(r=>r.path===f.path&&r.bytes===f.bytes&&r.sha256===f.sha256&&r.contentType===f.contentType)),'链上文件与批准版本不同，请先导入并确认新版本',409);
  demand(!report.fallback||files.some(f=>f.path===report.fallback),'链上回退文件不存在',409);
  const value={schema:GATEWAY_SCHEMA,projectId:release.projectId,releaseId:release.id,target:{...target,cpu:getAddress(report.cpu),container:getAddress(report.container)},blockNumber:report.blockNumber,blockHash:report.blockHash,files,fallback:report.fallback,manifestHash:release.manifestHash};
  return {...value,versionId:digest(value),checkedAt:report.checkedAt,paidUntil:report.paidUntil,nativeUrl:nativeUrl(target),verification:'two-rpc-snapshot',mode:'pinned'};
}
export function gatewayChallenge(store,release,wallet,ownerId,origin,at=Date.now(),actorId=ownerId) {
  assertApproved(store,release);const target=gatewayTarget(store.project(release.projectId).chain),address=getAddress(wallet);
  const challenge={id:randomBytes(24).toString('hex'),ownerId,actorId,releaseId:release.id,projectId:release.projectId,target,wallet:address,approvalDigest:approvalDigest(store,release),expiresAt:at+300000};
  challenge.message=['TapeNow Gateway — publish verified website',new URL(origin).origin,'This signature authorizes a public gateway snapshot. It sends no transaction.',`Account: ${ownerId}`,`Project: ${release.projectId}`,`Release: ${release.id}`,`Manifest: ${release.manifestHash}`,`Chain: ${target.chainId}`,`CPU: ${target.cpuIndex}`,`NFT: ${target.tokenId}`,`Wallet: ${address}`,`Nonce: ${challenge.id}`,`Expires: ${new Date(challenge.expiresAt).toISOString()}`].join('\n');
  challenge.message+='\nActing account: '+actorId;return challenge;
}
export function verifyGatewayChallenge(store,release,input,ownerId,at=Date.now(),actorId=ownerId) {
  assertApproved(store,release);const q=release.gatewayChallenge;
  demand(q&&q.ownerId===ownerId&&q.actorId===actorId&&q.id===input.challengeId&&q.expiresAt>at&&!q.used,'网关签名确认已过期或已使用',409);
  demand(q.approvalDigest===approvalDigest(store,release)&&digest(q.target)===digest(gatewayTarget(store.project(release.projectId).chain)),'发布目标或文件已变化，请重新确认',409);
  let signer;try{signer=verifyMessage(q.message,input.signature);}catch{}
  demand(signer?.toLowerCase()===q.wallet.toLowerCase(),'钱包签名与芯片持有人不匹配',403);return q;
}
export function assertGatewayOwner(identity,challenge,at=Date.now()) {
  demand(identity.opened&&identity.paidUntil>at,'容器未开通或激活已到期',409);
  demand(digest(gatewayTarget(identity))===digest(challenge.target)&&identity.owner.toLowerCase()===challenge.wallet.toLowerCase(),'芯片所有权或发布目标已变化',403);
}
export const gatewayVersionHost=(versionId,root)=>'gw-v-'+versionId.slice(0,48)+'.'+root;
export const gatewayProjectHost=(projectId,root)=>'gw-'+projectId+'.'+root;
export function gatewayPath(pathname,files,fallback) {
  let path;try{path=decodeURIComponent(pathname).replace(/^\//,'');}catch{return null;}
  if(/[\\\x00-\x1f\x7f]/.test(path)||path.split('/').some(p=>p==='..'||p.startsWith('.')))return null;
  const names=new Set(files.map(f=>f.path));
  for(const p of [path,path+'index.html',path.replace(/\/$/,'')+'/index.html'])if(names.has(p))return p;
  return !path.split('/').pop().includes('.')&&names.has(fallback)?fallback:null;
}
