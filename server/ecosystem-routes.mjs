import {demand,parseFiles,now,id} from './core.mjs';
import {ecosystemLinks,resolveContainer,createHealthReader,domainDns,verifyPublicDns,verifyChainFiles} from './ecosystem.mjs';
import {readVerifiedArtifact} from './chain-observer.mjs';
import {prepareDomainBinding,checkDomainBinding} from './chain.mjs';
import {assertApproved,approvalDigest} from './release-policy.mjs';
import {verifySiteRemote} from './site-checker.mjs';
export function mountEcosystemRoutes(app,{store,locked=async(_key,work)=>work(),beforeImport=async()=>{},resolve=resolveContainer,readArtifact=readVerifiedArtifact,health=createHealthReader(),prepareBinding=prepareDomainBinding,checkBinding=checkDomainBinding,dnsCheck=verifyPublicDns,fileCheck=verifyChainFiles,checker,siteCheck=verifySiteRemote}) {
 app.get('/api/projects/:pid/ecosystem',(req,res)=>res.json(ecosystemLinks(store.project(req.params.pid).chain)));
 app.get('/api/ecosystem/health',async(_req,res)=>res.json(await health()));
 app.post('/api/projects/:pid/container/resolve',async(req,res)=>res.json(await resolve(store.project(req.params.pid).chain,req.body?.wallet)));
 app.post('/api/projects/:pid/chain-import',async(req,res)=>{await locked('import:'+req.params.pid,async()=>{const project=store.project(req.params.pid),target={...project.chain};await beforeImport(project.id);const report=await readArtifact(target);demand(report.chainId===(target.chainId??196),'导入读取网络与目标不匹配',409);demand(JSON.stringify(project.chain)===JSON.stringify(target),'导入期间链目标发生变化',409);const parsed=parseFiles({files:report.files});const release=store.createRelease(project.id,parsed,{type:'chain-import',chainId:report.chainId,cpu:report.cpu,container:report.container,block:report.blockNumber,blockHash:report.blockHash,nativeUrl:report.nativeUrl,ownershipGranted:false},'链上站点归档');res.json(release);});});
 const domain=id=>{const d=store.state.domains.find(d=>d.id===id);demand(d,'域名不存在',404);return d;};
 app.post('/api/domains/:did/chain-prepare',async(req,res)=>{const d=domain(req.params.did),r=store.release(req.body?.releaseId);demand(r.projectId===d.projectId,'版本与域名项目不匹配',409);await locked('chain:'+r.id,async()=>{const result=await prepareBinding(store,r,d);res.json({...result,dns:domainDns(d.hostname,r.plan.container)});});});
 app.post('/api/domains/:did/chain-verify',async(req,res)=>{const d=domain(req.params.did),r=store.release(req.body?.releaseId);demand(r.projectId===d.projectId,'版本与域名项目不匹配',409);const t=d.chainBinding;demand(t&&t.releaseId===r.id&&t.manifestHash===r.manifestHash&&t.name===d.hostname&&t.chainId===r.plan?.chainId&&t.container===r.plan?.container,'域名目标与版本不匹配',409);assertApproved(store,r,'chain');store.validateRelease(r);
  try{
   const binding=await checkBinding(t),dns=await dnsCheck(t.name,t.container);
   const files=await fileCheck({chainId:t.chainId,cpuIndex:r.plan.cpuIndex,tokenId:r.plan.tokenId},r.files);
   const config=typeof checker==='function'?checker():checker;
   const https=config?.url||config?.token?await siteCheck(config,t.name,r.files):null;
   if(https){
    demand(https.status==='verified'&&https.verified===true&&https.hostname===t.name&&https.scope==='private-node-checker','HTTPS 内容检查未通过',409);
    await checkBinding(t);await dnsCheck(t.name,t.container);
   }
   assertApproved(store,r,'chain');demand(d.chainBinding===t&&d.hostname===t.name&&r.manifestHash===t.manifestHash,'核验期间目标发生变化',409);
   d.chainBinding={...t,...binding,status:'verified',checkedAt:now()};
   d.verification={binding,dns,files,...(https?{https}:{}),manifestHash:r.manifestHash};
   if(https){
    delete d.browserCheck;d.status='active';
    d.detail='链上绑定、DNS 与检查服务的 HTTPS 文件比对已通过；不代表所有地区或浏览器缓存';
    d.accessCheck={at:now(),failedPaths:[],httpsVerified:true,scope:'private-node-checker',manifestHash:r.manifestHash};
   }else{
    d.status='pending-access-check';d.detail='链上绑定、公开 DNS 与链上文件已核验；网关与自定义域名 HTTPS 等待当前浏览器检查';
    d.browserCheck={id:id('domain-access'),startedAt:Date.now(),expiresAt:Date.now()+300000,hostname:t.name,chainId:t.chainId,container:t.container,releaseId:r.id,manifestHash:r.manifestHash,approvalDigest:approvalDigest(store,r)};
   }
   store.save();res.json(d);
  }catch(e){if(d.chainBinding===t){d.status='pending';d.chainBinding={...t,status:'unverified',checkedAt:now()};store.save();}throw e;}
 });
 app.post('/api/domains/:did/chain-access',async(req,res)=>{
  const d=domain(req.params.did),r=store.release(req.body?.releaseId),check=d.browserCheck,t=d.chainBinding;
  assertApproved(store,r,'chain');
  demand(check&&req.body.checkId===check.id&&Date.now()<check.expiresAt&&d.status==='pending-access-check'&&d.projectId===r.projectId&&check.releaseId===r.id&&check.manifestHash===r.manifestHash&&check.hostname===d.hostname&&check.chainId===r.plan?.chainId&&check.container===r.plan?.container&&check.approvalDigest===approvalDigest(store,r)&&t?.name===check.hostname&&t?.container===check.container,'域名访问核验已过期或目标发生变化',409);
  demand(Array.isArray(req.body.failedPaths)&&req.body.failedPaths.length<=r.files.length&&req.body.failedPaths.every(path=>r.files.some(f=>f.path===path)),'访问核验结果无效');
  delete d.browserCheck;d.accessCheck={at:now(),failedPaths:req.body.failedPaths,httpsVerified:req.body.httpsVerified===true,scope:'current-browser',manifestHash:r.manifestHash};
  if(req.body.failedPaths.length||req.body.httpsVerified!==true){store.save();demand(false,'当前浏览器 HTTPS 或文件核验尚未通过，请重试检查',409);}
  try{await checkBinding(t);await dnsCheck(t.name,t.container);assertApproved(store,r,'chain');demand(d.chainBinding===t&&d.hostname===check.hostname&&r.manifestHash===check.manifestHash&&approvalDigest(store,r)===check.approvalDigest,'核验期间目标发生变化',409);d.status='active';d.detail='链上文件与当前浏览器的自定义域名 HTTPS 文件均已核验';store.save();res.json(d);}catch(e){d.status='pending-access-check';store.save();throw e;}
 });

}
