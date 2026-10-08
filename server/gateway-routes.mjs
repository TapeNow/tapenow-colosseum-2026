import {randomBytes} from 'node:crypto';
import {demand} from './core.mjs';
import {CHAINS} from './chains.mjs';
import {gatewayChallenge,readGatewayIdentity,assertGatewayOwner,gatewayProjectHost} from './gateway.mjs';
import {gatewayEnabled,publishGateway,checkGatewayProject,gatewayBinding,writeGatewayBinding,deleteGatewayBinding,retireGatewayVersion,recoverGatewayCatalog} from '../cloud/gateway.mjs';
import {saasConfigured,createSaasClient} from '../cloud/cf-saas.mjs';

export const gatewayCapabilities=()=>({schema:'tapenow-gateway-capabilities/v1',chains:Object.values(CHAINS).map(c=>({chainId:c.chainId,name:c.name,nativeSymbol:c.nativeSymbol,read:true,publish:true,gateway:true,hashport:c.chainId===56})),mode:'pinned',walletSignature:'personal_sign',maxFiles:500,maxBytes:10485760,readOnlyVisitors:true,webmcpRegistered:true,webmcpRequiresNativeBrowser:true});
export async function verifyGatewayDns(records,{fetcher=fetch}={}) {
  for(const record of records){
    const u=new URL('https://cloudflare-dns.com/dns-query');u.searchParams.set('name',record.name);u.searchParams.set('type',record.type);
    const response=await fetcher(u,{headers:{Accept:'application/dns-json'},redirect:'manual',signal:AbortSignal.timeout(10000)});demand(response.ok,'DNS 核验暂不可用',503);
    const data=await response.json();demand(data.Status===0,'DNS 记录尚未生效',409);
    const values=(data.Answer||[]).filter(v=>v.type===(record.type==='TXT'?16:5)).map(v=>record.type==='TXT'?String(v.data).replace(/"\s*"/g,'').replace(/^"|"$/g,''):String(v.data).replace(/\.$/,''));
    demand(values.includes(record.content),'DNS 记录尚未匹配，请等待生效或检查配置',409);
  }
  return true;
}
export function mountGatewayRoutes(app,{store,environment,user,signingActor,beforePublic,afterPublic,commit=async()=>{},identity=readGatewayIdentity,readArtifact,saas=createSaasClient,dns=verifyGatewayDns}) {
  const env=()=>typeof environment==='function'?environment():environment;
  const actor=()=>typeof user==='function'?user():user;
  const signer=()=>signingActor?signingActor().id:actor().id;
  const dom=id=>{const d=store.state.domains.find(d=>d.id===id);demand(d&&d.provider==='gateway','网关域名不存在',404);return d;};
  app.get('/api/gateway/capabilities',(_req,res)=>res.json(gatewayCapabilities()));
  app.get('/api/projects/:pid/gateway',(req,res)=>{const p=store.project(req.params.pid);res.json({configured:gatewayEnabled(env()),customDomains:saasConfigured(env()),capabilities:gatewayCapabilities(),site:p.gateway||null,pending:(p.pendingPublications||[]).some(x=>x.kind==='gateway'),domains:store.state.domains.filter(d=>d.projectId===p.id&&d.provider==='gateway')});});
  app.post('/api/projects/:pid/gateway/recover',async(req,res)=>res.json(await recoverGatewayCatalog(env(),store,actor(),store.project(req.params.pid))));
  app.post('/api/releases/:rid/gateway/prepare',async(req,res)=>{
    demand(gatewayEnabled(env()),'TapeNow Gateway 尚未配置',409);const r=store.release(req.params.rid);
    const q=gatewayChallenge(store,r,req.body.wallet,actor().id,env().APP_ORIGIN,Date.now(),signer());
    assertGatewayOwner(await identity(q.target),q);r.gatewayChallenge=q;store.save();res.json(q);
  });
  app.post('/api/releases/:rid/gateway/publish',async(req,res)=>res.json(await publishGateway(env(),store,actor(),store.release(req.params.rid),req.body,{beforePublic,afterPublic,identity,actorId:signer(),...(readArtifact?{readArtifact}:{})})));
  app.post('/api/releases/:rid/gateway/restore',async(req,res)=>res.json(await publishGateway(env(),store,actor(),store.release(req.params.rid),req.body,{beforePublic,afterPublic,identity,actorId:signer(),restore:true})));
  app.post('/api/releases/:rid/gateway/retire',async(req,res)=>res.json(await retireGatewayVersion(env(),store,actor(),store.release(req.params.rid))));
  app.post('/api/projects/:pid/gateway/check',async(req,res)=>res.json(await checkGatewayProject(env(),store,actor(),store.project(req.params.pid),{identity,...(readArtifact?{readArtifact}:{}),content:req.body.content!==false})));
  app.post('/api/domains/:did/gateway-prepare',async(req,res)=>{
    const d=dom(req.params.did),p=store.project(d.projectId);demand(p.gateway,'请先发布项目的 Gateway 入口',409);
    demand(!d.hostname.endsWith('.'+env().GATEWAY_ROOT)&&d.hostname!==env().GATEWAY_ROOT,'平台域名保留给自动生成的入口；请使用客户域名',409);
    const record=await gatewayBinding(env(),gatewayProjectHost(p.id,env().GATEWAY_ROOT));demand(record&&record.owner===actor().id,'项目网关归属不匹配',409);
    const result=await checkGatewayProject(env(),store,actor(),p,{identity});demand(result.status==='active','芯片归属核验未通过',409);
    d.gateway||={ownershipToken:randomBytes(24).toString('hex'),ready:false};
    store.save();await commit();
    await writeGatewayBinding(env(),d.hostname,{...record,gateway:{...record.gateway,status:'pending',customAlias:true}});
    const client=saas(env()),cf=d.gateway.cfId?await client.status(d.gateway.cfId,d.hostname):await client.create(d.hostname);
    d.gateway={...d.gateway,cfId:cf.id,cfStatus:cf.status,sslStatus:cf.sslStatus,records:[{type:'CNAME',name:d.hostname,content:env().GATEWAY_CNAME,proxied:false,ttl:300},{type:'TXT',name:'_tapenow.'+d.hostname,content:d.gateway.ownershipToken,ttl:300},...cf.validation.map(r=>({...r,ttl:300}))],ready:false};
    store.save();res.json(d.gateway);
  });
  app.post('/api/domains/:did/gateway-check',async(req,res)=>{
    const d=dom(req.params.did),p=store.project(d.projectId);demand(d.gateway?.cfId,'请先准备域名与证书',409);
    await dns(d.gateway.records.filter(r=>r.type==='CNAME'||r.name==='_tapenow.'+d.hostname));
    const cf=await saas(env()).status(d.gateway.cfId,d.hostname);d.gateway.sslStatus=cf.sslStatus;d.gateway.cfStatus=cf.status;store.save();demand(cf.ready,'域名证书尚未就绪，请稍后重新核验',409);
    const health=await checkGatewayProject(env(),store,actor(),p,{identity});demand(health.status==='active','网关芯片归属未通过核验',409);
    const record=await gatewayBinding(env(),gatewayProjectHost(p.id,env().GATEWAY_ROOT));demand(record?.owner===actor().id,'网关归属不匹配',409);
    await writeGatewayBinding(env(),d.hostname,{...record,gateway:{...record.gateway,alias:true,customAlias:true}});
    d.detail='Gateway 域名归属与证书已核验，访问时跳转到固定版本网址';d.gateway.ready=true;d.gateway.checkedAt=new Date().toISOString();d.status='verified';store.save();res.json(d.gateway);
  });
  app.post('/api/domains/:did/gateway-disconnect',async(req,res)=>{
    const d=dom(req.params.did);await deleteGatewayBinding(env(),d.hostname,actor().id,d.projectId);
    if(d.gateway?.cfId)await saas(env()).remove(d.gateway.cfId,d.hostname);
    d.gateway={ready:false,disconnectedAt:new Date().toISOString()};d.status='pending';d.detail='网关已断开，DNS 记录保留';store.save();res.json({disconnected:true,dnsRetained:true});
  });
}
