import {workflowTemplate} from "./workflow-template.mjs";
import {demand,id,now,zipFiles,MAX_BYTES,sha} from './core.mjs';
const GH='https://api.github.com';
const ghHeaders=token=>({Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'TapeNow'});
async function github(config,path,body,method) {
  const r=await fetch(GH+path,{method:method||(body?'POST':'GET'),headers:{...ghHeaders(config.token),'Content-Type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});
  const data=r.status===204?{}:await r.json().catch(()=>({}));
  demand(r.ok,'GitHub 操作未完成（'+r.status+'）'+(r.status===404?'：请检查仓库、构建流程和授权范围':''),r.status===404?409:502);return data;
}
export function validBuildOptions(input={}) {
  const root=String(input.rootDirectory||'.'), output=String(input.outputDirectory||'dist');
  for(const v of [root,output])demand(v==='.'||(/^[\w.-]+(?:\/[\w.-]+)*$/.test(v)&&v.split('/').every(p=>p!=='.'&&p!=='..')),'构建目录只能使用仓库内的相对路径');
  const buildCommand=String(input.buildCommand||'npm run build');
  demand(buildCommand.length<=1000&&!buildCommand.includes('\0'),'构建命令无效');
  return {rootDirectory:root,outputDirectory:output,buildCommand};
}
export async function readArtifact(config,artifact) {
  demand(artifact&&!artifact.expired&&artifact.size_in_bytes<=MAX_BYTES,'构建产物不存在、已过期或超过 10 MiB',409);
  const r=await fetch(GH+'/repos/'+config.repository+'/actions/artifacts/'+artifact.id+'/zip',{headers:ghHeaders(config.token),redirect:'manual',signal:AbortSignal.timeout(20000)});
  demand(r.status===302,'GitHub 未返回产物下载地址',502);
  const url=new URL(r.headers.get('location'));
  demand(url.protocol==='https:'&&!url.username&&!url.password&&(/\.blob\.core\.windows\.net$|\.githubusercontent\.com$|\.actions\.githubusercontent\.com$/.test(url.hostname)),'产物下载域名不受支持',502);
  // Never forward the GitHub bearer token to the artifact storage host.
  const zip=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(30000)});
  demand(zip.ok&&Number(zip.headers.get('content-length')||0)<=MAX_BYTES,'构建产物下载失败或过大',502);
  const reader=zip.body.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();demand(false,'构建 ZIP 超过 10 MiB');}chunks.push(value);}
  return zipFiles(Buffer.concat(chunks));
}
export function mountSourceRoutes(app,{store,oauth}) {
  async function config(pid,provider) {
    store.project(pid);const c=store.state.connections[pid+':'+provider+':preview'];
    demand(c?.status==='connected','请先连接 '+provider+' 项目来源',409);
    return {connection:c,...await oauth.credentials(c)};
  }
  async function inspect(pid) {
    const v=await config(pid,'vercel');demand(v.connection.grantId,'请使用 Vercel 官方授权',409);
    const {data:p}=await oauth.request(v.connection.grantId,'/v9/projects/'+encodeURIComponent(v.projectId));
    const {data:listing}=await oauth.request(v.connection.grantId,'/v6/deployments?projectId='+encodeURIComponent(v.projectId)+'&state=READY&target=production&limit=10');
    const d=listing.deployments?.[0];demand(d,'没有已完成的 Vercel 生产部署可供导入',409);
    const {data:deployment}=await oauth.request(v.connection.grantId,'/v13/deployments/'+encodeURIComponent(d.uid||d.id));
    const meta=deployment.meta||{};const repository=p.link?.type==='github' ? p.link.org+'/'+p.link.repo : null;
    const commit=meta.githubCommitSha||deployment.gitSource?.sha||null;
    const framework=p.framework||'static';
    const staticFrameworks=['static','vite','create-react-app','vue','vitepress','docusaurus-2','gatsby'];
    const explicitExport=p.outputDirectory==='out' || /\bnext export\b/.test(p.buildCommand||'');
    const compatible=staticFrameworks.includes(framework)||explicitExport;
    const outputDefaults={static:'.',vite:'dist',vue:'dist','create-react-app':'build',vitepress:'.vitepress/dist','docusaurus-2':'build',gatsby:'public'};
    return {projectId:p.id,name:p.name,deploymentId:deployment.id||d.uid,framework,repository,commit,rootDirectory:p.rootDirectory||'.',outputDirectory:p.outputDirectory||outputDefaults[framework]||'dist',buildCommand:p.buildCommand||(framework==='static'?'true':'npm run build'),compatible:!!(compatible&&repository&&commit),requiresRuntime:!compatible,
      reasons:[...(!compatible?['此框架可能依赖 SSR / API，需完成运行时适配后再部署']:[]),...(!repository?['没有可读的 GitHub 来源，请上传构建包']:[]),...(!commit?['源部署没有可核对的 Git commit']:[])],
      configurationNote:'不会读取或复制 Vercel 秘密。需要的构建配置应在仓库的 Actions 环境中配置；原站保持在线。'};
  }
  async function createJob(pid,options,vercel=null) {
    const c=await config(pid,'github');const root='/repos/'+c.repository;
    const repo=await github(c,root);const branch=String(options.ref||repo.default_branch);
    demand(/^[\w./-]{1,160}$/.test(branch)&&!branch.includes('..'),'分支无效');
    const commit=vercel?.commit||(await github(c,root+'/commits/'+encodeURIComponent(branch))).sha;
    demand(/^[a-f0-9]{40}$/.test(commit),'来源 commit 不完整',409);
    if(vercel)demand(c.repository.toLowerCase()===vercel.repository.toLowerCase(),'GitHub 授权仓库与 Vercel 来源不一致',409);
    const job={id:id('job'),projectId:pid,provider:vercel?'vercel':'github',repository:c.repository,commit,createdAt:now(),status:'queued',options:validBuildOptions(vercel||options),...(vercel?{vercel}:{} )};
    const result=await github(c,root+'/actions/workflows/tapenow-build.yml/dispatches',{ref:branch,inputs:{job_id:job.id,source_sha:commit,root_directory:job.options.rootDirectory,output_directory:job.options.outputDirectory,build_command:job.options.buildCommand}});
    demand(result.workflow_run_id,'GitHub 未返回构建任务编号，请先检查 Actions 运行记录',502);
    job.runId=result.workflow_run_id;job.url=result.html_url;store.state.sourceJobs||={};store.state.sourceJobs[job.id]=job;store.save();store.log(pid,'已启动 GitHub 隔离构建 '+job.id);return job;
  }
  app.get('/api/projects/:pid/source-jobs',(req,res)=>{store.project(req.params.pid);res.json(Object.values(store.state.sourceJobs||{}).filter(j=>j.projectId===req.params.pid));});
  app.get('/api/projects/:pid/github-workflow',async(req,res)=>{
    const c=await config(req.params.pid,'github');const workflows=await github(c,'/repos/'+c.repository+'/actions/workflows');
    const workflow=workflows.workflows?.find(w=>w.path==='.github/workflows/tapenow-build.yml');res.json({installed:!!workflow,workflow,templateUrl:'/docs/tapenow-build.yml'});
  });
  app.post('/api/projects/:pid/github-workflow',async(req,res)=>{
    demand(req.body.confirmed===true,'请先确认向仓库添加构建流程');
    const c=await config(req.params.pid,'github');
    const workflows=await github(c,'/repos/'+c.repository+'/actions/workflows');
    demand(!workflows.workflows?.some(w=>w.path==='.github/workflows/tapenow-build.yml'),'已存在构建流程，不会覆盖',409);
    const result=await github(c,'/repos/'+c.repository+'/contents/.github/workflows/tapenow-build.yml',{message:'Add TapeNow isolated build workflow',content:Buffer.from(workflowTemplate).toString('base64')},'PUT');
    store.log(req.params.pid,'已安装 TapeNow 构建流程','success');res.json({installed:true,commit:result.commit.sha});
  });
  app.post('/api/projects/:pid/github-build',async(req,res)=>res.json(await createJob(req.params.pid,req.body)));
  app.post('/api/projects/:pid/vercel-inspect',async(req,res)=>res.json(await inspect(req.params.pid)));
  app.post('/api/projects/:pid/vercel-import',async(req,res)=>{const report=await inspect(req.params.pid);demand(report.compatible,'此项目尚不满足静态导入条件，请查看兼容性报告',409);res.json(await createJob(req.params.pid,req.body,report));});
  app.get('/api/source-jobs/:jid',async(req,res)=>{
    const job=store.state.sourceJobs?.[req.params.jid];demand(job,'构建任务不存在',404);store.project(job.projectId);
    if(['imported','failed','cancelled'].includes(job.status))return res.json(job);
    const c=await config(job.projectId,'github');demand(c.repository===job.repository,'项目构建来源已改变',409);
    const run=await github(c,'/repos/'+c.repository+'/actions/runs/'+job.runId);
    if(run.status==='completed'&&run.conclusion!=='success'){job.status=run.conclusion==='cancelled'?'cancelled':'failed';job.error='GitHub 构建未成功：'+run.conclusion;}
    else job.status=run.status==='completed'?'built':run.status;
    job.url=run.html_url;job.updatedAt=now();store.save();res.json(job);
  });
  app.post('/api/source-jobs/:jid/import',async(req,res)=>{
    const job=store.state.sourceJobs?.[req.params.jid];demand(job,'构建任务不存在',404);store.project(job.projectId);
    if(job.releaseId)return res.json(store.release(job.releaseId));
    const c=await config(job.projectId,'github');demand(c.repository===job.repository,'构建来源已变化',409);
    const base='/repos/'+c.repository+'/actions/runs/'+job.runId;
    const run=await github(c,base);demand(run.status==='completed'&&run.conclusion==='success','构建尚未成功',409);
    const listing=await github(c,base+'/artifacts?per_page=100');
    const artifact=listing.artifacts?.find(a=>a.name==='deweb-dist-'+job.id&&!a.expired);
    const parsed=await readArtifact(c,artifact);
    const provenanceFile=parsed.files.find(f=>f.path==='tapenow-build.json');
    demand(provenanceFile,'缺少构建来源记录',409);
    const provenance=JSON.parse(Buffer.from(provenanceFile.base64,'base64'));
    demand(provenance.jobId===job.id&&provenance.commit===job.commit,'构建来源与请求的 commit 不一致',409);
    const r=store.createRelease(job.projectId,parsed,{type:job.provider,repository:job.repository,commit:job.commit,runId:job.runId,artifactId:artifact.id,workflowCommit:run.head_sha,...(job.vercel?{vercelProjectId:job.vercel.projectId,vercelDeploymentId:job.vercel.deploymentId}:{})},'导入 · '+job.repository.split('/')[1]);
    job.status='imported';job.releaseId=r.id;store.save();res.json(r);
  });
  // Compatibility entrypoint: import an existing artifact, using the App grant if present.
  app.post('/api/projects/:pid/github-artifact',async(req,res)=>{
    const c=await config(req.params.pid,'github');const listing=await github(c,'/repos/'+c.repository+'/actions/artifacts?per_page=100');
    const artifact=listing.artifacts?.find(a=>!a.expired&&a.name===(req.body.artifactName||'deweb-dist'));
    demand(artifact,'没有可导入的构建产物',409);
    const run=await github(c,'/repos/'+c.repository+'/actions/runs/'+artifact.workflow_run.id);demand(run.conclusion==='success','构建未成功',409);
    const parsed=await readArtifact(c,artifact);res.json(store.createRelease(req.params.pid,parsed,{type:'github',repository:c.repository,commit:artifact.workflow_run.head_sha,runId:run.id,artifactId:artifact.id},'GitHub 构建'));
  });
}
