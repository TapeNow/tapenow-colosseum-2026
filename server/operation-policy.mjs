import {createHash} from 'node:crypto';
import {demand} from './core.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
export function operationKind(method,path) {
  if(method!=='POST')return null;
  if(new RegExp('/chain/readback$').test(path))return 'content-verification';
  if(new RegExp('/gateway/check$').test(path))return 'gateway-verification';
  if(new RegExp('/projects/[^/]+/(import|sample|restore)$').test(path))return 'artifact';
  if(new RegExp('/releases/[^/]+/(verify|chain/prepare)$').test(path))return 'preparation';
  return null;
}
export function operationIdentity({actorId,method,path,body,key}) {
  demand(typeof key==='string'&&/^[a-zA-Z0-9_-]{16,100}$/.test(key),'操作编号格式无效');
  return {key:'operation:'+hash(actorId+':'+key),digest:hash(JSON.stringify({method,path,body})),actorId,kind:operationKind(method,path)};
}
export async function beginOperation(storage,input,time=Date.now()) {
  const identity=operationIdentity(input),prior=await storage.get(identity.key);
  if(prior){
    demand(prior.digest===identity.digest,'同一操作编号不能用于不同参数',409);
    if(prior.status!=='complete')throw Object.assign(Error('这项操作可能已执行，请查看操作记录和版本后再继续；不会自动重复执行'),{status:409,code:'operation_in_progress',operationId:prior.id});
    return {...identity,replay:prior};
  }
  const recent=await storage.list({prefix:'operation:'});
  for(const [key,value] of recent)if(value.at<time-7*86400000)await storage.delete(key);
  demand([...recent.values()].filter(v=>v.at>=time-7*86400000).length<2000,'操作记录额度已用完，仍可查询、导出和处理待确认交易',429);
  const record={id:input.key,digest:identity.digest,actorId:input.actorId,kind:identity.kind,projectId:input.projectId||null,at:time,status:'running'};
  await storage.put(identity.key,record);return {...identity,record};
}
export async function finishOperation(storage,operation,response,body,time=Date.now()) {
  if(!operation||operation.replay)return;
  const bytes=Buffer.byteLength(body);
  const record={...operation.record,status:bytes<=60000?'complete':'needs_reconciliation',finishedAt:time,httpStatus:response.status,...(bytes<=60000?{body}:{}),contentType:response.headers.get('content-type')};
  await storage.put(operation.key,record);
}
export function publicOperation(record){const {id,kind,projectId,at,status,finishedAt,httpStatus}=record;return {id,kind,projectId,at,status,finishedAt,httpStatus};}
export async function pruneOperationalData(storage,time=Date.now()){
  const cutoff=new Date(time-30*86400000).toISOString().slice(0,10);let removed=0;
  for(const [key,value]of await storage.list({prefix:'operation:'}))if(value.at<time-7*86400000){await storage.delete(key);removed++;}
  for(const [key,value]of await storage.list({prefix:'resources:'}))if(value.day<cutoff){await storage.delete(key);removed++;}
  return removed;
}
