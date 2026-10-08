import {demand} from '../server/core.mjs';
import {hostname} from '../server/ecosystem.mjs';

export function saasConfigured(env){return Boolean(env.GATEWAY_CF_TOKEN&&env.GATEWAY_CF_ZONE&&env.GATEWAY_CNAME);}
export function createSaasClient(env,{fetcher=fetch,serialize=true}={}) {
  demand(saasConfigured(env),'客户域名服务尚未配置',409);
  const base='https://api.cloudflare.com/client/v4/zones/'+env.GATEWAY_CF_ZONE;
  async function request(path,method='GET',body){
    const r=await fetcher(base+path,{method,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+env.GATEWAY_CF_TOKEN,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const data=await r.json().catch(()=>({}));
    demand(r.ok&&data.success===true,'Cloudflare 域名或证书操作未完成，请重试或检查平台配置',503);return data;
  }
  function publicRecord(r){return {id:r.id,hostname:r.hostname,status:r.status,sslStatus:r.ssl?.status,ready:r.status==='active'&&r.ssl?.status==='active',validation:[...(r.ownership_verification?.type==='txt'?[{type:'TXT',name:r.ownership_verification.name,content:r.ownership_verification.value}]:[]),...(r.ssl?.validation_records||[]).filter(v=>v.txt_name&&v.txt_value).map(v=>({type:'TXT',name:v.txt_name,content:v.txt_value}))]};}
  return {
    async create(name){
      if(serialize&&env.PUBLICATIONS){
        const queue=env.PUBLICATIONS.get(env.PUBLICATIONS.idFromName('gateway:saas-quota:'+env.GATEWAY_CF_ZONE));
        const r=await queue.fetch('https://internal/saas/create',{method:'POST',body:JSON.stringify({hostname:name})});
        const v=await r.json();demand(r.ok,v.error||'客户域名创建失败',r.status);return v;
      }
      hostname(name);const listing=await request('/custom_hostnames?hostname='+encodeURIComponent(name)+'&per_page=100');
      const match=listing.result.find(r=>r.hostname===name);if(match)return publicRecord(match);
      // Protect the included allowance. Do not opt into paid extra hostnames.
      const all=await request('/custom_hostnames?per_page=100');
      const total=all.result_info?.total_count;
      demand(Number.isInteger(total)&&total<90&&all.result.length<90,'免费域名名额保护已触发，请联系维护者评估费用',409);
      const made=await request('/custom_hostnames','POST',{hostname:name,ssl:{method:'txt',type:'dv',settings:{min_tls_version:'1.2'}}});return publicRecord(made.result);
    },
    async status(id,name){demand(/^[\w-]{20,80}$/.test(id),'域名服务记录无效',409);const r=(await request('/custom_hostnames/'+id)).result;demand(r.hostname===name,'域名服务记录不匹配',409);return publicRecord(r);},
    async remove(id,name){demand(/^[\w-]{20,80}$/.test(id),'域名服务记录无效',409);const rows=(await request('/custom_hostnames?hostname='+encodeURIComponent(name)+'&per_page=100')).result;const r=rows.find(r=>r.id===id);if(!r)return {removed:true};demand(r.hostname===name,'域名服务记录不匹配',409);await request('/custom_hostnames/'+id,'DELETE');return {removed:true};}
  };
}
