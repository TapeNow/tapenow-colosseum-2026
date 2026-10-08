import {retentionReport,setRetentionPolicy,setArchivePin,trashArchives,restoreArchive,archiveBytes} from './archive-policy.mjs';
import {databaseReport,beginEmailTest,verifyEmailTest} from './data-services.mjs';
import {observeChain} from './chain-observer.mjs';
import {demand} from './core.mjs';
export function mountBatch2Routes(app,{store,oauth,user=()=>null,metrics=async()=>({days:[],scope:'本地模式不采集访问统计'})}) {
  app.get('/api/projects/:pid/retention',(req,res)=>res.json(retentionReport(store,req.params.pid)));
  app.patch('/api/projects/:pid/retention',(req,res)=>res.json(setRetentionPolicy(store,req.params.pid,req.body)));
  app.post('/api/projects/:pid/trash',(req,res)=>res.json(trashArchives(store,req.params.pid,req.body)));
  app.post('/api/releases/:rid/archive-restore',(req,res)=>res.json(restoreArchive(store,req.params.rid)));
  app.patch('/api/releases/:rid/archive-pin',(req,res)=>res.json(setArchivePin(store,req.params.rid,req.body.pinned)));
  app.get('/api/projects/:pid/data-health',async(req,res)=>res.json(await databaseReport(store,oauth,req.params.pid)));
  app.post('/api/projects/:pid/email-test/:environment',async(req,res)=>res.json(await beginEmailTest(store,oauth,req.params.pid,req.params.environment,req.body,user())));
  app.post('/api/projects/:pid/email-verify/:environment',async(req,res)=>res.json(await verifyEmailTest(store,oauth,req.params.pid,req.params.environment,req.body,user())));
  app.post('/api/projects/:pid/chain-observe',async(req,res)=>{
    const p=store.project(req.params.pid);demand(!p.chainObservation||Date.now()-Date.parse(p.chainObservation.checkedAt)>30000,'请等待 30 秒后再次核验',429);
    const latest=store.state.releases.find(r=>r.projectId===p.id&&r.chainStatus==='verified');
    p.chainObservation=await observeChain(p.chain,{expected:latest?.files,previous:p.chainObservation?.files?.length?p.chainObservation:undefined});store.save();
    store.log(p.id,'链上只读核验：'+p.chainObservation.status,p.chainObservation.status==='verified'?'success':'info');res.json(p.chainObservation);
  });
  app.get('/api/projects/:pid/diagnostics',async(req,res)=>{
    const p=store.project(req.params.pid),releases=store.state.releases.filter(r=>r.projectId===p.id);
    res.json({traffic:await metrics(p.id),archive:{bytes:releases.reduce((n,r)=>n+archiveBytes(r),0),versions:releases.filter(r=>r.archive?.state!=='purged').length,accountBytes:store.state.releases.reduce((n,r)=>n+archiveBytes(r),0),accountLimit:250*1024*1024},chain:p.chainObservation||null,checks:[{name:'当前版本',status:p.siteProductionId||p.productionId?'ready':'missing',detail:p.siteProductionId||p.productionId||'尚未发布'},{name:'Supabase 环境',status:['preview','production'].every(e=>store.state.connections[p.id+':supabase:'+e])?'configured':'incomplete',detail:'实际连接和邮件送达请在 Storage 检查'},{name:'域名',status:store.state.domains.some(d=>d.projectId===p.id&&d.status==='active')?'active':'optional',detail:'外部域名由供应商管理'}],checkedAt:new Date().toISOString()});
  });
  app.patch('/api/onboarding',(req,res)=>{demand(typeof req.body.dismissed==='boolean','引导参数无效');store.state.preferences.onboardingDismissed=req.body.dismissed;store.save();res.json({saved:true});});
}
