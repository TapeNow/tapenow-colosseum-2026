import {demand,sha,now} from './core.mjs';

export function databaseTarget(input) {
  let u;try{u=new URL(input?.url);}catch{demand(false,'数据库地址无效');}
  demand(u.protocol==='https:'&&/^[a-z0-9]{20}\.supabase\.co$/.test(u.hostname)&&!u.username&&!u.password&&!u.port,'只支持 Supabase 官方项目地址');
  demand(typeof input.key==='string'&&(input.key.startsWith('sb_publishable_')||input.key.startsWith('eyJ')),'需要公开客户端密钥');
  if(input.key.startsWith('eyJ')){let p;try{p=JSON.parse(Buffer.from(input.key.split('.')[1],'base64url'));}catch{}demand(p?.role==='anon','不能使用管理密钥');}
  return {url:u.origin,key:input.key,ref:u.hostname.split('.')[0]};
}
async function authRequest(config,path,input,fetcher=fetch) {
  const response=await fetcher(config.url+'/auth/v1/'+path,{method:input?'POST':'GET',redirect:'manual',
    headers:{apikey:config.key,'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Object.assign(new Error(response.status===429?'邮件发送过于频繁，请稍后再试':'Supabase Auth 未完成请求；请检查邮件服务、邮箱资格及项目设置'),{status:response.status===429?429:409});
  return response.json();
}
export async function environmentConfig(store,oauth,pid,environment) {
  store.project(pid);demand(['preview','production'].includes(environment),'环境无效');
  const c=store.state.connections[pid+':supabase:'+environment];demand(c,'请先连接这个环境的 Supabase',409);
  return databaseTarget(await oauth.credentials(c));
}
export async function databaseReport(store,oauth,pid,{fetcher=fetch}={}) {
  const p=store.project(pid),environments=[];
  for(const environment of ['preview','production']) {
    try {
      const config=await environmentConfig(store,oauth,pid,environment);
      const settings=await authRequest(config,'settings',null,fetcher);
      const test=p.emailTests?.[environment];
      environments.push({environment,status:'reachable',url:config.url,ref:config.ref,key:config.key,
        emailEnabled:settings.external?.email===true,signupDisabled:settings.disable_signup===true,
        smtpStatus:test?.digest===sha(config.url+'\0'+config.key)&&test.status==='verified'?'verified':'unverified',
        emailTest:test?.digest===sha(config.url+'\0'+config.key)?{status:test.status,at:test.at}:null,
        settingsUrl:'https://supabase.com/dashboard/project/'+config.ref+'/auth/smtp',
        scope:'Auth API 可达；邮件只有收到并验证验证码后才算送达'});
    }catch(e){environments.push({environment,status:'unavailable',error:e.status?e.message:'供应商暂时无法连接'});}
  }
  const ready=environments.filter(e=>e.status==='reachable');
  return {environments,isolation:ready.length<2?'incomplete':ready[0].ref===ready[1].ref?'shared':'separate',checkedAt:now(),
    note:'两个连接不自动复制数据或执行 SQL；生产构建需要明确使用生产配置。'};
}
export async function beginEmailTest(store,oauth,pid,environment,input,user,{fetcher=fetch,time=Date.now()}={}) {
  const email=String(input.email||'').trim().toLowerCase();
  demand(user?.email&&email===user.email.toLowerCase(),'只能向当前登录邮箱发送测试验证码',403);
  demand(input.confirm===true,'请确认此操作会向你的邮箱发送验证码，并可能创建客户应用测试账号');
  const p=store.project(pid),config=await environmentConfig(store,oauth,pid,environment);
  p.emailTests||={};const prior=p.emailTests[environment];
  demand(!prior||time-Date.parse(prior.at)>=60000,'请等待一分钟再发送',429);
  await authRequest(config,'otp',{email,create_user:true},fetcher);
  p.emailTests[environment]={status:'sent',at:new Date(time).toISOString(),digest:sha(config.url+'\0'+config.key),emailHash:sha(email)};
  store.save();store.log(pid,`${environment} 邮件测试请求已接受，等待实际收信验证`);
  return {sent:true,scope:'请求接受不等于邮件已送达'};
}
export async function verifyEmailTest(store,oauth,pid,environment,input,user,{fetcher=fetch,time=Date.now()}={}) {
  demand(user?.email,'请先登录',401);demand(/^\d{6,10}$/.test(String(input.token||'')),'请输入邮件验证码');
  const p=store.project(pid),config=await environmentConfig(store,oauth,pid,environment),pending=p.emailTests?.[environment];
  demand(pending?.status==='sent'&&pending.digest===sha(config.url+'\0'+config.key)&&pending.emailHash===sha(user.email.toLowerCase())&&time-Date.parse(pending.at)<600000,'测试已过期或数据库连接已变化，请重新发送',409);
  const result=await authRequest(config,'verify',{email:user.email.toLowerCase(),token:String(input.token),type:'email'},fetcher);
  demand(result.access_token&&result.user?.email?.toLowerCase()===user.email.toLowerCase(),'邮箱核验未完成',409);
  // End only this synthetic Auth session. Never revoke the user's other app sessions.
  const logout=await fetcher(config.url+'/auth/v1/logout?scope=local',{method:'POST',redirect:'manual',headers:{apikey:config.key,Authorization:'Bearer '+result.access_token},signal:AbortSignal.timeout(10000)}).catch(()=>({ok:false}));
  pending.status='verified';pending.at=new Date(time).toISOString();pending.sessionClosed=logout.ok;
  store.save();store.log(pid,`${environment} 真实邮件收信与验证码核验通过`,'success');
  return {verified:true,sessionClosed:logout.ok,at:pending.at};
}
