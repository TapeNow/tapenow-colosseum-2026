import {X509Certificate} from 'node:crypto';
import {isIP} from 'node:net';
import {connect as tlsConnect} from 'node:tls';
import pg from 'pg';
import {demand,now} from './core.mjs';

// Conservative public-unicast policy: IPv6 is intentionally unsupported, including mapped IPv4.
export function isPublicAddress(address) {
  if(isIP(address)!==4)return false;
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2||b===88&&c===99)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export const isCloudflareRuntime=()=>typeof navigator==='object'&&navigator?.userAgent==='Cloudflare-Workers';
export async function publicIPv4Records(host,{fetcher=fetch}={}) {
  const url=new URL('https://cloudflare-dns.com/dns-query');url.searchParams.set('name',host);url.searchParams.set('type','A');
  const response=await fetcher(url.href,{headers:{Accept:'application/dns-json'},redirect:'manual',signal:AbortSignal.timeout(5000)});
  demand(response.ok,'公开 DNS 查询失败',409);const reader=response.body?.getReader();demand(reader,'公开 DNS 响应不完整',409);let size=0;const parts=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;demand(size<=65536,'公开 DNS 响应过大',409);parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  const data=JSON.parse(Buffer.concat(parts).toString());demand(data.Status===0,'公开 DNS 查询失败',409);return (data.Answer||[]).filter(a=>a.type===1).map(a=>a.data);
}
export async function resolvePublicHost(host,{resolver=publicIPv4Records}={}) {
  demand(typeof host==='string'&&host.length<=253&&/^[a-z0-9.-]+$/i.test(host)&&!host.endsWith('.')&&host.includes('.'),'需要公开 IPv4 或域名');
  const addresses=isIP(host)?[host]:await resolver(host);
  demand(Array.isArray(addresses)&&addresses.length>0&&addresses.length<=64&&addresses.every(isPublicAddress),'地址解析必须全部为允许的公开 IPv4');
  return addresses[0];
}
export function postgresTarget(input) {
  demand(input&&typeof input==='object'&&!Array.isArray(input),'连接参数无效');
  demand(Object.keys(input).every(k=>['host','port','database','user','password','caPEM'].includes(k)),'不允许连接字符串、SSL 或查询选项');
  for(const k of ['host','database','user','password'])demand(typeof input[k]==='string'&&input[k].length>0&&input[k].length<=(k==='password'?1024:253)&&!/[\x00-\x1f\x7f]/.test(input[k]),'连接参数无效');
  demand(/^[a-z0-9.-]+$/i.test(input.host),'数据库主机无效');
  const port=input.port===undefined?5432:Number(input.port);demand(Number.isInteger(port)&&port>=1024&&port<=65535,'数据库端口无效');
  let caPEM;
  if(input.caPEM!==undefined&&input.caPEM!==''){
    demand(typeof input.caPEM==='string'&&Buffer.byteLength(input.caPEM)<=16384,'CA 证书必须为不超过16KiB的 PEM',409);
    caPEM=input.caPEM.trim();const certificates=caPEM.match(/-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g)||[];
    demand(certificates.length>0&&certificates.length<=8&&caPEM.replace(/-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g,'').trim()==='','只接受 PEM 公共证书，不接受私钥或其他 TLS 配置',409);
    try{for(const cert of certificates)new X509Certificate(cert);}catch{demand(false,'CA 证书格式无效',409);}
  }
  return {host:input.host.toLowerCase(),port,database:input.database,user:input.user,password:input.password,...(caPEM?{caPEM}:{})};
}
async function deadline(work,ms,onTimeout=()=>{}) {
  let timer;try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{onTimeout();reject(Error('timeout'));},ms);})]);}finally{clearTimeout(timer);}
}
export async function checkPostgres(input,{resolver,clientFactory=config=>new pg.Client(config),timeoutMs=8000,runtime=isCloudflareRuntime()?'cloudflare':'node',ca}={}) {
  const target=postgresTarget(input);let client,cancelled=false;
  const active=()=>{if(cancelled)throw Error('timeout');};
  try{return await deadline(async()=>{
    const address=await resolvePublicHost(target.host,{resolver});active();
    // Native Worker TCP connects by hostname and enforces its own private-address
    // guard and TLS trust store. Node pins the checked IP with hostname validation.
    const trustedCA=target.caPEM||ca;
    demand(!trustedCA||runtime==='node','当前云端运行时不支持自定义 CA，请使用已配置的可信 Node 检查服务',409);
    client=clientFactory({...target,host:runtime==='cloudflare'?target.host:address,ssl:{rejectUnauthorized:true,servername:target.host,minVersion:'TLSv1.2',...(trustedCA?{ca:trustedCA}:{})},connectionTimeoutMillis:timeoutMs,query_timeout:timeoutMs,options:'-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000',application_name:'tapenow_readonly_check'});
    client.on?.('error',()=>{});
    await client.connect();active();
    await client.query('BEGIN READ ONLY');active();
    const result=await client.query("SELECT current_setting('transaction_read_only') AS read_only, current_setting('default_transaction_read_only') AS default_read_only, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user");
    active();await client.query('ROLLBACK');active();
    const row=result.rows?.[0];
    demand(row&&row.read_only==='on'&&row.default_read_only==='on','只读检查失败');
    const privileged=['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'].some(k=>row[k]!==false);
    demand(!privileged,'请使用无管理权限的专用数据库角色');
    return {status:'verified',tls:'verified',readOnly:true,roleFlags:'nonAdministrative',connectionPolicy:runtime==='cloudflare'?'dns-precheck-platform-tcp':'pinned-ipv4-tls',checkedAt:now(),scope:'仅检查只读会话和角色管理标记；不读取业务表，不证明角色无表写权限'};
  },Math.min(Math.max(timeoutMs,1),12000),()=>{cancelled=true;client?.connection?.stream?.destroy();});}
  catch{throw Object.assign(Error('PostgreSQL 检查失败：请检查公开 IPv4、TLS 证书、专用低权限角色与连接超时'),{status:409});}
  finally{try{const ended=client?.end();ended?.catch?.(()=>{});}catch{}}
}
export function apiTarget(input) {
  let u;try{u=new URL(input);}catch{demand(false,'API 地址无效');}
  demand(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&(!u.port||u.port==='443')&&u.href.length<=2048,'API 必须为无凭证、查询参数的公开 HTTPS 地址');
  return u;
}
// Raw TLS HEAD pins the checked address; fetch/https in Workers may re-resolve a hostname.
export async function checkBusinessApi(input,{resolver,connect=tlsConnect,timeoutMs=8000,runtime=isCloudflareRuntime()?'cloudflare':'node',fetcher=fetch}={}) {
  const u=apiTarget(input);let socket,cancelled=false;
  try{return await deadline(async()=>{
    const address=await resolvePublicHost(u.hostname,{resolver});if(cancelled)throw Error('timeout');
    if(runtime==='cloudflare'){
      // Global platform fetch has no private-network binding. DNS is prechecked;
      // routing/TLS are platform-managed, not represented as an IP-pinned check.
      const response=await fetcher(u.href,{method:'HEAD',redirect:'manual',credentials:'omit',headers:{'User-Agent':'TapeNow-Connectivity'},signal:AbortSignal.timeout(Math.min(12000,Math.max(1,timeoutMs)))});
      await response.body?.cancel();if(cancelled)throw Error('timeout');
      demand(response.status>=200&&response.status<300,'API 返回不可用状态',409);
      return {status:'verified',httpStatus:response.status,checkedAt:now(),connectionPolicy:'dns-precheck-platform-fetch',scope:'公开端点 HEAD 可达，TLS 与路由由云平台处理；未验证业务逻辑或鉴权'};
    }
    return await new Promise((resolve,reject)=>{
      socket=connect({host:address,port:443,servername:u.hostname,rejectUnauthorized:true,minVersion:'TLSv1.2'},()=>{
        if(socket.authorized!==true){socket.destroy();reject(Error('TLS'));return;}
        socket.write(`HEAD ${u.pathname} HTTP/1.1\r\nHost: ${u.hostname}\r\nConnection: close\r\nUser-Agent: TapeNow-Connectivity\r\n\r\n`);
      });
      let headers='';socket.on('error',reject);socket.on('end',()=>reject(Error('incomplete')));
      socket.on('data',chunk=>{headers+=chunk.toString('latin1');if(headers.length>16384){socket.destroy();reject(Error('limit'));return;}if(!headers.includes('\r\n\r\n'))return;
        const status=Number(/^HTTP\/1\.[01] (\d{3}) /.exec(headers)?.[1]);socket.destroy();
        if(status<200||status>=300){reject(Error('unavailable'));return;}
        resolve({status:'verified',httpStatus:status,checkedAt:now(),scope:'公开端点 HEAD 可达；未验证业务逻辑或鉴权'});
      });
    });
  },Math.min(Math.max(timeoutMs,1),12000),()=>{cancelled=true;socket?.destroy();});}
  catch{throw Object.assign(Error('API 检查失败：公开地址、TLS、响应或超时不符合要求'),{status:409});}
  finally{socket?.destroy();}
}
