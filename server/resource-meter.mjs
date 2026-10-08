import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const measureResources=(metrics,work)=>context.run(metrics,work);
export function countRpc(body){
  const metrics=context.getStore();if(!metrics)return;
  try{const parsed=JSON.parse(typeof body==='string'?body:Buffer.from(body).toString());
    for(const item of Array.isArray(parsed)?parsed:[parsed])if(/^eth_[A-Za-z]+$/.test(item?.method||''))metrics[item.method]=(metrics[item.method]||0)+1;
  }catch{/* Instrumentation never changes request semantics. */}
}
export async function recordResourceSample(storage,{projectId,kind,status,durationMs,rpc},time=Date.now()) {
  const day=new Date(time).toISOString().slice(0,10),key='resources:'+day+':'+(projectId||'workspace');
  const record=await storage.get(key)||{day,projectId:projectId||null,operations:0,failures:0,durationMs:0,rpc:{},kinds:{}};
  record.operations++;record.failures+=status>=400?1:0;record.durationMs+=durationMs;record.kinds[kind]=(record.kinds[kind]||0)+1;
  for(const [method,count]of Object.entries(rpc))record.rpc[method]=(record.rpc[method]||0)+count;
  await storage.put(key,record);
  const cleanupDay=await storage.get('resources-cleanup');
  if(cleanupDay!==day){const cutoff=new Date(time-30*86400000).toISOString().slice(0,10);for(const [k,v]of await storage.list({prefix:'resources:'}))if(v.day<cutoff)await storage.delete(k);await storage.put('resources-cleanup',day);}
}
