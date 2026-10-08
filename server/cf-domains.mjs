import {demand,now} from './core.mjs';
import {digest} from './release-policy.mjs';

export function dnsRecords(domain, target) {
  demand(typeof domain.hostname==='string'&&/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain.hostname),'域名无效');
  if(domain.provider==='gateway'){
    demand(domain.gateway?.records?.length,'请先准备 Gateway 域名与证书',409);
    return domain.gateway.records;
  }
  if(domain.provider==='hashport') {
    demand(target.chainId===56&&/^0x[a-f0-9]{40}$/i.test(target.container||''),'HashPort 需要已核验的 BSC 容器',409);
    return [{type:'CNAME',name:domain.hostname,content:'cname.hashport.org',proxied:false,ttl:300},{type:'TXT',name:'_tapeout.'+domain.hostname,content:target.container.toLowerCase(),ttl:300}];
  }
  demand(/^[a-z0-9-]+\.pages\.dev$/.test(target.pagesHost||''),'请先连接已验证的 Cloudflare Pages 部署',409);
  return [{type:'CNAME',name:domain.hostname,content:target.pagesHost,proxied:false,ttl:300}];
}
export function dnsChanges(desired,existing) {
  return desired.map(record=>{
    const sameName=existing.filter(r=>r.name.toLowerCase()===record.name.toLowerCase());
    const exact=sameName.find(r=>r.type===record.type&&r.content.toLowerCase()===record.content.toLowerCase()&&(record.type!=='CNAME'||r.proxied===false));
    // Never replace an unrelated live site or silently discard TXT records.
    const certificateTxt=record.type==='TXT'&&record.name.startsWith('_acme-challenge.')&&sameName.every(r=>r.type==='TXT');
    demand(!sameName.length||sameName.length===1&&exact||certificateTxt,'DNS 已存在不同记录，请先在 Cloudflare 核对，TapeNow 不会覆盖现有服务',409);
    return {...record,action:exact?'keep':'create'};
  });
}
export function mountCfDomainRoutes(app,{store,oauth,cfRequest}) {
  async function credentials(pid){const c=store.state.connections[pid+':cloudflare:production']||store.state.connections[pid+':cloudflare:preview'];demand(c,'请先连接 Cloudflare',409);return oauth.credentials(c);}
  async function zones(c){const found=await cfRequest(c,'/zones?account.id='+c.accountId+'&status=active&per_page=50');demand(Array.isArray(found),'域名区域读取失败',502);return found;}
  function domain(id){const d=store.state.domains.find(x=>x.id===id);demand(d,'域名不存在',404);return d;}
  async function plan(d){
    const p=store.project(d.projectId),c=await credentials(p.id),all=await zones(c);
    const zone=all.filter(z=>d.hostname===z.name||d.hostname.endsWith('.'+z.name)).sort((a,b)=>b.name.length-a.name.length)[0];
    demand(zone,'当前 Cloudflare 授权中没有此域名区域；请重新授权域名权限',403);
    demand(d.hostname!==zone.name,'首版请使用子域名，以免影响根域现有服务',409);
    const r=store.state.releases.find(r=>r.id===p.cloudflareProductionId);
    const chainRelease=store.state.releases.find(r=>r.projectId===p.id&&r.chainStatus==='verified'&&r.plan?.chainId===56&&r.plan.cpuIndex===p.chain.cpuIndex&&r.plan.tokenId===p.chain.tokenId);
    const desired=dnsRecords(d,{chainId:p.chain.chainId,container:chainRelease?.plan?.container,pagesHost:r?.cloudflareProduction?.status==='success'?r.cloudflareProduction.projectName+'.pages.dev':null});
    const existing=[];
    for(const name of new Set(desired.map(x=>x.name)))existing.push(...await cfRequest(c,'/zones/'+zone.id+'/dns_records?name='+encodeURIComponent(name)+'&per_page=100'));
    const changes=dnsChanges(desired,existing),result={zoneId:zone.id,zoneName:zone.name,hostname:d.hostname,provider:d.provider||'pages',changes};
    return {credentials:c,...result,digest:digest(result)};
  }
  app.get('/api/projects/:pid/cloudflare/zones',async(req,res)=>{store.project(req.params.pid);res.json((await zones(await credentials(req.params.pid))).map(z=>({id:z.id,name:z.name,status:z.status})));});
  app.post('/api/domains/:did/dns-plan',async(req,res)=>{const d=domain(req.params.did),{credentials:_,...result}=await plan(d);d.dnsPlan={digest:result.digest,expiresAt:Date.now()+300000};store.save();res.json(result);});
  app.post('/api/domains/:did/dns-apply',async(req,res)=>{
    const d=domain(req.params.did);demand(d.dnsPlan?.digest===req.body.digest&&d.dnsPlan.expiresAt>Date.now(),'DNS 变更确认已过期，请重新检查',409);
    const p=await plan(d);demand(p.digest===req.body.digest,'DNS 或目标已变化，请重新检查',409);
    d.dnsOperation={status:'applying',at:now(),digest:p.digest,created:[]};store.save();
    for(const {action,...record} of p.changes)if(action==='create'){
      const created=await cfRequest(p.credentials,'/zones/'+p.zoneId+'/dns_records',{method:'POST',body:JSON.stringify({...record,comment:'TapeNow '+d.projectId})});
      d.dnsOperation.created.push(created.id);store.save();
    }
    d.zoneId=p.zoneId;d.dnsOperation.status='configured';delete d.dnsPlan;store.save();
    store.log(d.projectId,'域名 DNS 已配置；HTTPS 与目标文件仍需核验','success');res.json({configured:true,needsVerification:true});
  });
  app.post('/api/domains/:did/purge',async(req,res)=>{
    const d=domain(req.params.did),p=await plan(d);
    const paths=req.body.paths||['/','/index.html'];demand(Array.isArray(paths)&&paths.length>0&&paths.length<=30&&paths.every(x=>typeof x==='string'&&x.startsWith('/')&&!x.startsWith('//')&&!/[?#\\\x00-\x20]/.test(x)&&!x.split('/').includes('..')),'缓存路径无效');
    const files=paths.map(x=>'https://'+d.hostname+x);
    await cfRequest(p.credentials,'/zones/'+p.zoneId+'/purge_cache',{method:'POST',body:JSON.stringify({files})});
    d.cachePurge={at:now(),paths,status:'requested'};store.save();res.json({requested:true,verified:false,detail:'已请求清理指定网址；请继续核验实际文件，不代表浏览器或所有地区缓存已刷新'});
  });
}
