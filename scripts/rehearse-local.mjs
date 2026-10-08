// Review-copy harness: only loopback HTTP and disposable local data. No provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as pause} from 'node:timers/promises';
import {unzipSync} from 'fflate';
import {keyFingerprint} from '../server/receipt-keys.mjs';
const root=path.resolve(import.meta.dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tapenow-review-'));
const data=path.join(temp,'data'),port=43911,previewPort=43912,base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'production',PORT:String(port),PREVIEW_PORT:String(previewPort),DEWEB_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
let log='';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
try{
  let session;
  for(let n=0;n<100;n++){
    if(server.exitCode!==null)throw Error('Server exited: '+log);
    try{const r=await fetch(base+'/api/session');if(r.ok){session=await r.json();break;}}catch{}
    await pause(100);
  }
  assert.equal(session?.mode,'local','Server must start safely in local mode');
  // Prevent accidentally using an unrelated listener at the fixed rehearsal port.
  await pause(100);assert.equal(server.exitCode,null,'Own local server must remain running');
  assert.ok(fs.existsSync(path.join(data,'signing-public.pem')),'Own temporary store was initialized');
  async function call(route,body){
    const r=await fetch(base+'/api'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Deweb-Token':session.token},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal(r.status,200,route);return r;
  }
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const project=await(await call('/projects',{name:'Local review sample'})).json();
  const v1=await(await call(`/projects/${project.id}/sample`,{version:1})).json();
  const v2=await(await call(`/projects/${project.id}/sample`,{version:2})).json();
  assert.notEqual(v1.manifestHash,v2.manifestHash);
  const files=await(await call(`/releases/${v1.id}/files`)).json();assert.ok(files.some(f=>f.path==='index.html'));
  const preview=await new Promise((resolve,reject)=>http.get(`http://127.0.0.1:${previewPort}/`,{headers:{Host:`${v1.id}.${project.id}.localhost:${previewPort}`}},r=>{let body='';r.on('data',b=>body+=b);r.on('end',()=>resolve({status:r.statusCode,body}));}).on('error',reject));
  assert.equal(preview.status,200);assert.match(preview.body,/<html/i);
  const check=await(await call(`/releases/${v1.id}/restore-check`)).json();
  const restored=await(await call(`/projects/${project.id}/restore`,{releaseId:v1.id,digest:check.digest,acknowledgeUnknown:true})).json();
  assert.equal(restored.restoredFrom,v1.id);assert.equal(restored.manifestHash,v1.manifestHash);
  const state=await(await call('/state')).json();assert.equal(state.projects.find(p=>p.id===project.id).productionId,null);
  const zip=new Uint8Array(await(await call(`/releases/${restored.id}/export`)).arrayBuffer());
  const archive=path.join(temp,'archive');
  for(const [name,bytes] of Object.entries(unzipSync(zip))){
    const dest=path.resolve(archive,name);assert.ok(dest.startsWith(archive+path.sep));
    fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);
  }
  const fingerprint=keyFingerprint(fs.readFileSync(path.join(data,'signing-public.pem'),'utf8'));
  const args=['scripts/verify-release.mjs',archive+'/release.json',archive+'/keys.json',fingerprint,archive+'/site'];
  const verified=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});assert.equal(verified.status,0,verified.stderr);
  fs.appendFileSync(archive+'/site/index.html','tampered');
  const changed=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});assert.equal(changed.status,1,'Tampered bytes must fail');
  console.log('PASS: local startup, CSRF gate, sample v1/v2, manifest, loopback preview, restore candidate without publication, archive verification and tamper rejection.');
  console.log('Only a local fixture signing key was trusted. No live-site or production verification; no email, wallet transaction or deployment.');
}finally{
  if(server.exitCode===null){const done=once(server,'exit');server.kill('SIGTERM');await done;}
  fs.rmSync(temp,{recursive:true,force:true});
}
