import {demand,id,now,sha} from './core.mjs';
import {cfRequest} from '../cloud/providers.mjs';

export const runtimeExample = `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const generatedAt = new Date().toISOString();
    const headers = {"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
    if(url.pathname === "/api/time") return Response.json({generatedAt, runtime:"Cloudflare Workers", release:"TapeNow runtime sample"}, {headers});
    if(url.pathname !== "/") return new Response("Not found", {status:404,headers});
    return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TapeNow · Live Coast</title><style>body{font:18px/1.7 system-ui;background:#102c35;color:#ecfffe;max-width:780px;margin:12vh auto;padding:30px}h1{font-size:clamp(40px,7vw,76px);line-height:1.1;color:#81e3d6}button{background:#ffa2cb;border:0;padding:15px 22px;border-radius:10px;font:inherit;cursor:pointer}code{display:block;overflow-wrap:anywhere;color:#81e3d6}</style><p>TAPENOW / LIVE COAST</p><h1>A page made<br>at this moment.</h1><p>This HTML was rendered on the server:</p><code>'+generatedAt+'</code><p>The API returns a new server timestamp each time.</p><button id="refresh">Call the live API</button><code id="result" aria-live="polite"></code><script>document.getElementById("refresh").onclick=async()=>{const r=await fetch("/api/time");document.getElementById("result").textContent=JSON.stringify(await r.json());};<\/script></html>', {headers:{...headers,"Content-Type":"text/html;charset=utf-8"}});
  }
};
`;
export function validateWorkerModule(input) {
 demand(typeof input==='string'&&Buffer.byteLength(input)<=256*1024&&input.trim().length>20,'请上传不超过 256 KiB 的单文件 ES Module');
 demand(/\bexport\s+default\b/.test(input),'入口必须导出 default fetch 处理器');
 return {bytes:Buffer.byteLength(input),sha256:sha(Buffer.from(input))};
}
export function runtimeBindings(store,p,environment,includeSecrets) {
 return p.environment.filter(e=>e.environment===environment).map(e=>{
   if(e.secret) {
     demand(includeSecrets,'此环境包含秘密，部署前请明确确认同步到目标 Worker',409);
     const record=store.state.connections[p.id+':env:'+e.id];demand(record,'秘密配置缺失',409);
     return {name:e.key,type:'secret_text',text:store.decrypt(record.secrets).value};
   }
   return {name:e.key,type:'plain_text',text:e.value};
 });
}
export function mountRuntimeRoutes(app,{store,oauth,provider=cfRequest}) {
 app.get('/api/runtime/template',(_req,res)=>res.json({source:runtimeExample,format:'Single bundled ES module',maxBytes:256*1024}));
 app.get('/api/projects/:pid/runtime',(req,res)=>{store.project(req.params.pid);res.json((store.state.runtimeDeployments||[]).filter(r=>r.projectId===req.params.pid));});
 app.post('/api/projects/:pid/runtime',async(req,res)=>{
   const p=store.project(req.params.pid),environment=req.body.environment||'preview';
   demand(['preview','production'].includes(environment),'环境无效');
   demand(req.body.confirmed===true,'请确认部署到自己的 Cloudflare 账户');
   const source=req.body.sample===true?runtimeExample:req.body.source,manifest=validateWorkerModule(source);
   const existing=store.state.runtimeDeployments||[];
   demand(existing.filter(r=>r.projectId===p.id).length<10,'首版每个项目最多 10 个独立运行时部署',429);
   const c=store.state.connections[p.id+':cloudflare:'+environment];demand(c?.status==='connected','请先连接此环境的 Cloudflare 账户',409);
   const credentials=await oauth.credentials(c),bindings=runtimeBindings(store,p,environment,req.body.includeSecrets===true);
   const base='/accounts/'+credentials.accountId+'/workers',subdomain=await provider(credentials,base+'/subdomain');
   demand(/^[a-z0-9-]+$/.test(subdomain.subdomain||''),'请先在 Cloudflare 控制台设置 workers.dev 子域名',409);
   const rid=id('rt'),name='tnw-'+p.id+'-'+rid;
   const metadata={main_module:'worker.mjs',compatibility_date:'2026-09-27',compatibility_flags:['nodejs_compat'],bindings,limits:{cpu_ms:50}};
   const form=new FormData();form.set('metadata',JSON.stringify(metadata));
   form.set('worker.mjs',new Blob([source],{type:'application/javascript+module'}),'worker.mjs');
   let uploaded,cpuLimitMode='custom-50ms';
   try { uploaded=await provider(credentials,base+'/scripts/'+name,{method:'PUT',body:form}); }
   catch(e) {
     // Free accounts reject custom CPU limits before uploading. Retain their plan limit.
     if(e.providerCode!==100328)throw e;
     delete metadata.limits;form.set('metadata',JSON.stringify(metadata));cpuLimitMode='plan-default';
     uploaded=await provider(credentials,base+'/scripts/'+name,{method:'PUT',body:form});
   }
   const record={id:rid,projectId:p.id,environment,name,accountId:credentials.accountId,...manifest,cpuLimitMode,versionId:uploaded.deployment_id||uploaded.id||null,createdAt:now(),status:'uploaded',url:'https://'+name+'.'+subdomain.subdomain+'.workers.dev',configuration:bindings.map(b=>({name:b.name,secret:b.type==='secret_text'})),sample:req.body.sample===true};
   // Record an uploaded script before enabling its public route, so a retry has an exact target.
   store.state.runtimeDeployments=[record,...existing];store.save();
   try{await provider(credentials,base+'/scripts/'+name+'/subdomain',{method:'POST',body:JSON.stringify({enabled:true,previews_enabled:false})});record.status='deployed';store.save();}
   catch{record.error='脚本已上传，公开入口未开启。请在 Cloudflare 中检查 Workers Scripts 权限。';store.save();}
   store.log(p.id,'运行时 '+name+' · '+record.status,record.status==='deployed'?'success':'warning');res.json(record);
 });
 app.post('/api/projects/:pid/runtime/:rid/verify',async(req,res)=>{
   store.project(req.params.pid);const r=(store.state.runtimeDeployments||[]).find(r=>r.id===req.params.rid&&r.projectId===req.params.pid);demand(r,'运行时不存在',404);
   const page=await fetch(r.url,{redirect:'manual',signal:AbortSignal.timeout(15000)});
   demand(page.ok,'运行时首页尚未可访问',502);
   if(r.sample){const api=await fetch(r.url+'/api/time',{redirect:'manual',signal:AbortSignal.timeout(15000)}),data=await api.json();demand(api.ok&&data.runtime==='Cloudflare Workers'&&Number.isFinite(Date.parse(data.generatedAt)),'运行时 API 读回失败',502);}
   r.checkedAt=now();r.status='verified';delete r.error;store.save();res.json({verified:true,checkedAt:r.checkedAt});
 });
}
