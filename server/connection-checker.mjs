import {demand} from './core.mjs';
import {postgresTarget,apiTarget} from './postgres.mjs';

// URL and bearer are platform configuration, never taken from an API request.
export async function checkConnectionRemote(config,kind,input,{fetcher=fetch}={}) {
  try {
    demand(['postgres','business-api'].includes(kind),'检查类型无效',409);
    const base=new URL(config?.url);
    demand(base.protocol==='https:'&&!base.username&&!base.password&&!base.search&&!base.hash&&base.pathname==='/'&&(!base.port||base.port==='443')&&base.hostname.includes('.')&&!/^[\d.]+$/.test(base.hostname),'检查服务配置无效',503);
    demand(typeof config.token==='string'&&config.token.length>=16&&config.token.length<=4096&&!/[\r\n]/.test(config.token),'检查服务配置无效',503);
    const normalized=kind==='postgres'?postgresTarget(input):{url:apiTarget(input.url).href};
    const body=JSON.stringify({kind,input:normalized});demand(Buffer.byteLength(body)<=24576,'检查请求过大',409);
    const response=await fetcher(new URL('/check',base).href,{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json',Accept:'application/json'},body,signal:AbortSignal.timeout(15000)});
    demand(response.ok,'检查服务暂不可用',503);const reader=response.body?.getReader();demand(reader,'检查服务响应无效',503);const parts=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;demand(size<=32768,'检查服务响应过大',503);parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
    const data=JSON.parse(Buffer.concat(parts).toString()),report=data.report??data;
    demand(report.status==='verified','连接检查未通过',409);
    if(kind==='postgres')demand(report.tls==='verified'&&report.readOnly===true&&report.roleFlags==='nonAdministrative','数据库安全检查未通过',409);
    else demand(Number.isInteger(report.httpStatus)&&report.httpStatus>=200&&report.httpStatus<300,'端点检查未通过',409);
    // Do not return arbitrary checker output or upstream error text to clients.
    return {status:'verified',...(kind==='postgres'?{tls:'verified',readOnly:true,roleFlags:'nonAdministrative'}:{httpStatus:report.httpStatus}),checkedAt:new Date().toISOString(),connectionPolicy:'private-node-checker-pinned-tls',scope:kind==='postgres'?'可信检查服务仅核验 TLS、只读会话与角色管理标记；未读取业务表，不证明角色无表写权限':'可信检查服务核验公开 HTTPS HEAD 可达；未验证业务逻辑或鉴权'};
  } catch {
    throw Object.assign(Error('连接检查未通过：请核对端点、TLS/CA、低权限角色或检查服务状态'),{status:409});
  }
}
