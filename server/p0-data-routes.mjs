import {checkConnectionRemote} from './connection-checker.mjs';
import {demand,now} from './core.mjs';
import {checkPostgres,postgresTarget,checkBusinessApi,apiTarget,isCloudflareRuntime} from './postgres.mjs';
import {dependencyInventory} from './dependencies.mjs';
export function mountP0DataRoutes(app,{store,oauth,postgresOptions={},apiOptions={},checker}) {
  const check=async(kind,input)=>{const config=typeof checker==='function'?checker():checker;if(config?.url||config?.token)return checkConnectionRemote(config,kind,input);demand(kind!=='postgres'||!isCloudflareRuntime(),'云端 PostgreSQL 检查服务尚未配置',503);return kind==='postgres'?checkPostgres(input,postgresOptions):checkBusinessApi(input.url,apiOptions);};
  const key=(pid,kind,environment)=>{store.project(pid);demand(['preview','production'].includes(environment),'环境无效');return pid+':'+kind+':'+environment;};
  for(const kind of ['postgres','business-api']){
    app.post('/api/projects/:pid/'+kind+'/:environment',async(req,res)=>{
      const {pid,environment}=req.params,k=key(pid,kind,environment);
      const credentials=kind==='postgres'?postgresTarget(req.body):{url:apiTarget(req.body?.url).href};
      const report=await check(kind,credentials);
      store.state.connections[k]={provider:kind,projectId:pid,environment,status:'connected',checkedAt:now(),label:kind==='postgres'?'PostgreSQL TLS':'客户业务 API',detail:report.scope,report,secrets:store.encrypt(credentials)};
      store.save();store.log(pid,kind+' · '+environment+' 只读连接检查通过','success');res.json({connected:true,report});
    });
    app.post('/api/projects/:pid/'+kind+'/:environment/check',async(req,res)=>{
      const {pid,environment}=req.params,k=key(pid,kind,environment),c=store.state.connections[k];demand(c,'连接不存在',404);
      try{const credentials=oauth?await oauth.credentials({...c,status:'connected'}):store.decrypt(c.secrets);
        c.report=await check(kind,credentials);c.status='connected';c.checkedAt=now();store.save();res.json(c.report);
      }catch(e){c.status='unavailable';c.report={status:'unavailable',checkedAt:now()};store.save();throw e;}
    });
    app.delete('/api/projects/:pid/'+kind+'/:environment',(req,res)=>{
      const {pid,environment}=req.params;delete store.state.connections[key(pid,kind,environment)];store.save();store.log(pid,kind+' 连接已移除；客户资源保留');res.json({disconnected:true});
    });
  }
  app.get('/api/projects/:pid/data-connections',(req,res)=>{store.project(req.params.pid);res.json({connections:Object.values(store.state.connections).filter(c=>c.projectId===req.params.pid&&['postgres','business-api'].includes(c.provider)).map(c=>({provider:c.provider,environment:c.environment,status:c.status,report:c.report}))});});
  app.get('/api/releases/:rid/dependencies',(req,res)=>{const r=store.release(req.params.rid);res.json(dependencyInventory(r.files,r.dependencyDeclarations||[]));});
  app.put('/api/releases/:rid/dependencies',(req,res)=>{
    const r=store.release(req.params.rid),report=dependencyInventory(r.files,req.body?.declarations);
    r.dependencyDeclarations=report.dependencies.filter(d=>d.sources.includes('declared')).map(d=>({url:d.origin,category:d.category}));
    store.save();res.json(report);
  });
}
