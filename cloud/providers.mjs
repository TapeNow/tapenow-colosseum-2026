import {assertApproved} from "../server/release-policy.mjs";
import {blake3} from '@noble/hashes/blake3';
import {demand,id,now,sha} from '../server/core.mjs';
import {pagesPublicPath as publicPath,verifyPagesManifest} from '../shared/pages-readback.mjs';
export {verifyPagesManifest} from '../shared/pages-readback.mjs';
export async function cfRequest(credentials, endpoint, init={}) {
  const r=await fetch('https://api.cloudflare.com/client/v4'+endpoint,{...init,redirect:'manual',signal:AbortSignal.timeout(25000),headers:{Authorization:'Bearer '+credentials.token,...(!(init.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...init.headers}});
  const data=await r.json().catch(()=>({}));
  if (!r.ok && /\/workers\/subdomain$/.test(endpoint) && (!init.method || init.method==='GET') && data.errors?.some(e=>e.code===10007))
    demand(false,'请先打开 Cloudflare 的 Workers & Pages 页面，完成 workers.dev 子域名初始化，再重试。',409);
  if (!r.ok || !data.success) throw Object.assign(new Error('Cloudflare 未完成操作（'+(data.errors?.[0]?.code||r.status)+'）'),{status:502,providerCode:data.errors?.[0]?.code});
  return data.result;
}
export function assetHash(f) {return Buffer.from(blake3(f.base64+(f.path.includes('.')?f.path.split('.').pop():''))).toString('hex').slice(0,32);}
export async function uploadPages(credentials,projectName,files,{branch='preview',commit}={}) {
  demand(/^[a-f0-9]{32}$/.test(credentials.accountId),'Cloudflare 账户无效');
  demand(/^[a-z0-9-]{1,58}$/.test(projectName) && /^[a-z0-9-]{1,58}$/.test(branch),'部署标识无效');
  const base='/accounts/'+credentials.accountId+'/pages/projects/'+projectName;
  const projects=await cfRequest(credentials,'/accounts/'+credentials.accountId+'/pages/projects');
  if(!projects.some(p=>p.name===projectName))await cfRequest(credentials,'/accounts/'+credentials.accountId+'/pages/projects',{method:'POST',body:JSON.stringify({name:projectName,production_branch:'production'})});
  const {jwt}=await cfRequest(credentials,base+'/upload-token');
  const hashes=files.map(assetHash), missing=await cfRequest({token:jwt},'/pages/assets/check-missing',{method:'POST',body:JSON.stringify({hashes})});
  const needed=new Set(missing), batch=[]; let batchBytes=0;
  async function flush(){if(batch.length){await cfRequest({token:jwt},'/pages/assets/upload',{method:'POST',body:JSON.stringify(batch)});batch.length=0;batchBytes=0;}}
  for(let i=0;i<files.length;i++)if(needed.has(hashes[i])) {
    const f=files[i]; if(batchBytes+f.base64.length>5*1024*1024)await flush();
    batch.push({key:hashes[i],value:f.base64,metadata:{contentType:f.contentType},base64:true});batchBytes+=f.base64.length;
  }
  await flush(); await cfRequest({token:jwt},'/pages/assets/upsert-hashes',{method:'POST',body:JSON.stringify({hashes})});
  const form=new FormData();form.set('manifest',JSON.stringify(Object.fromEntries(files.map((f,i)=>['/'+f.path,hashes[i]]))));
  form.set('branch',branch);form.set('commit_dirty','true');if(commit&&/^[a-f0-9]{40}$/.test(commit))form.set('commit_hash',commit);
  let result=await cfRequest(credentials,base+'/deployments',{method:'POST',body:form});
  for(let n=0;n<12&&result.latest_stage?.status!=='success';n++) {
    demand(!['failure','canceled'].includes(result.latest_stage?.status),'Cloudflare 部署未成功',502);
    await new Promise(r=>setTimeout(r,1000));result=await cfRequest(credentials,base+'/deployments/'+result.id);
  }
  demand(result.latest_stage?.status==='success' && /^https:\/\/[\w.-]+\.pages\.dev$/.test(result.url),'Cloudflare 部署尚未就绪，请稍后重试',502);
  return {url:result.url,status:'success',projectName,deploymentId:result.id,branch,at:now()};
}
export async function verifyPagesHomepage(url,expected,{fetchImpl=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  // Pages canonicalizes /index.html to /. Read the final homepage directly.
  for(let attempt=0;attempt<4;attempt++) {
    try {
      const check=await fetchImpl(url+'/',{redirect:'manual',signal:AbortSignal.timeout(10000)});
      if(check.ok && sha(Buffer.from(await check.arrayBuffer()))===expected)return;
    } catch {}
    if(attempt<3)await pause(1000*(attempt+1));
  }
  demand(false,'部署文件读回不一致，请稍后重试',502);
}
export function pagesVerificationPlan(store,project,release,{production=false}={}) {
  const paths=new Set(release.files.map(f=>publicPath(f.path))),removed=new Set();
  if(production)for(const old of store.state.releases) {
    if(old.projectId!==project.id || !old.cloudflareProduction?.deploymentId)continue;
    for(const f of old.files)if(!paths.has(publicPath(f.path)))removed.add(f.path);
  }
  // Bound provider requests, including historical paths. Never silently sample a large manifest.
  demand(release.files.length+removed.size<=1000,'历史受管路径超过本轮 1,000 路径核验上限，需要维护者分批处理后再发布。',409);
  return {files:release.files,removed:[...removed].sort()};
}
export async function verifyCloudflareDeployment(store,project,release,{production=false,...verification}={}) {
  store.validateRelease(release);
  const result=release[production?'cloudflareProduction':'cloudflare'];
  demand(result?.deploymentId && result.projectName==='tn-'+project.id,'没有可核验的 Cloudflare 部署',409);
  if(production)demand(!project.cloudflarePendingId || project.cloudflarePendingId===release.id,'已有更新的生产部署，请先核验该版本',409);
  const url=production?'https://'+result.projectName+'.pages.dev':result.url;
  const plan=pagesVerificationPlan(store,project,release,{production});
  result.verification=await verifyPagesManifest(url,plan,verification);
  result.verification.removedPaths=plan.removed;
  delete result.browserCheckId;delete result.verifiedUrl;
  if(production)delete project.cloudflareProductionId;
  if(result.verification.failed.length) {
    result.status='pending-verification';
    delete result.verifiedUrl;
    if(production && project.cloudflareProductionId===release.id)delete project.cloudflareProductionId;
    const failed=result.verification.failed[0];
    result.error='Cloudflare 已完成上传，但'+(failed.removed?'已删除路径仍返回旧内容：':'文件尚未读回正确版本：')+failed.path+'。可稍后点击「重试核验」，不会再次上传。固定版本地址可单独打开检查；生产入口尚未确认一致。';
    store.save();
    demand(false,result.error,409);
  }
  result.checkedAt=now();delete result.error;
  if(production) {
    result.status='pending-browser-verification';result.browserCheckId=id('check');project.cloudflarePendingId=release.id;
    result.error='服务端节点已核验；还需检查当前浏览器的访问节点。请点击「重试核验」。';
  }else{result.status='success';result.verifiedUrl=url;}
  store.save();store.log(project.id,'Cloudflare '+(production?'生产镜像服务端':'预览')+'已逐文件读回；核验 '+plan.removed.length+' 个删除路径','success',release.id);
  return result;
}
export function confirmCloudflareAccess(store,project,release,input) {
  assertApproved(store,release);
  const result=release.cloudflareProduction;
  demand(result?.status==='pending-browser-verification' && result.browserCheckId===input.checkId && result.deploymentId===input.deploymentId && project.cloudflarePendingId===release.id,'核验已更新，请重新检查生产入口',409);
  demand(Date.now()-Date.parse(result.checkedAt)<300000,'核验已过期，请重新检查生产入口',409);
  const allowed=new Set([...release.files.map(f=>f.path),...(result.verification.removedPaths||[])]);
  demand(Array.isArray(input.failedPaths)&&input.failedPaths.length<=1000&&input.failedPaths.every(p=>typeof p==='string'&&allowed.has(p)),'访问检查结果无效');
  result.verification.browser={failedPaths:[...new Set(input.failedPaths)],at:now()};delete result.browserCheckId;
  if(input.failedPaths.length) {
    result.status='pending-verification';result.error='当前访问节点未通过核验：'+input.failedPaths[0]+'。可能是旧缓存、网络或跨域限制；可打开固定版本地址，稍后重试核验生产镜像。';
    store.save();demand(false,result.error,409);
  }
  result.status='success';result.verifiedUrl='https://'+result.projectName+'.pages.dev';delete result.error;
  project.cloudflareProductionId=release.id;release.receipt=store.receiptFor(release,'cloud-file-verification');store.save();store.log(project.id,'生产镜像已在服务端和当前访问节点逐文件核验；不代表全球缓存一致','success',release.id);
  return result;
}
export async function deployCloudflare(store,project,release,credentials,_dir,{production=false}={}) {
  store.validateRelease(release);
  if(production)assertApproved(store,release);
  pagesVerificationPlan(store,project,release,{production});
  const result=await uploadPages(credentials,'tn-'+project.id,release.files,{branch:production?'production':release.id,commit:release.source.commit});
  release[production?'cloudflareProduction':'cloudflare']={...result,status:'pending-verification'};
  if(production){project.cloudflarePendingId=release.id;delete project.cloudflareProductionId;}
  store.save();
  return verifyCloudflareDeployment(store,project,release,{production});
}
export async function checkConnection(provider,input) {
  if(provider==='cloudflare') {
    demand(/^[a-f0-9]{32}$/i.test(input.accountId||'')&&input.token?.length>=20,'Cloudflare 配置无效');
    const rows=await cfRequest(input,'/accounts/'+input.accountId+'/pages/projects');
    return {label:'Cloudflare Pages',detail:'可访问 '+rows.length+' 个项目'};
  }
  if(provider==='supabase') {
    const u=new URL(input.url); demand(u.protocol==='https:'&&/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname)&&!u.port&&!u.username&&!u.password,'只支持 Supabase 官方 HTTPS 项目地址');
    const key=input.key;
    demand(typeof key==='string'&&(key.startsWith('sb_publishable_')||key.startsWith('eyJ')),'请输入公开 key');
    if(key.startsWith('eyJ'))demand(JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role==='anon','只允许公开 anon key');
    const r=await fetch(u.origin+'/auth/v1/settings',{headers:{apikey:key},redirect:'manual',signal:AbortSignal.timeout(15000)});
    demand(r.ok,'Supabase 公开配置验证失败',400);return {label:u.hostname.split('.')[0],detail:'公开配置及 Auth API 已验证；业务权限需另验'};
  }
  if(provider==='github') {
    demand(/^[\w.-]+\/[\w.-]+$/.test(input.repository||''),'仓库格式应为 owner/repo');
    const r=await fetch('https://api.github.com/repos/'+input.repository,{headers:{Accept:'application/vnd.github+json','User-Agent':'TapeNow',...(input.token?{Authorization:'Bearer '+input.token}:{})},signal:AbortSignal.timeout(15000)});
    demand(r.ok,'仓库不可访问',400);const data=await r.json();return {label:data.full_name,detail:data.private?'私有仓库':'公开仓库'};
  }
  demand(false,'请使用此服务的官方授权入口',400);
}
