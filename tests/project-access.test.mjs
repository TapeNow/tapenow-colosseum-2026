import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeProjectRequest,sharedState,assertNotSuspended,memberResponse,auditAuthorization} from '../server/project-access.mjs';
import {listMemberships,manageMembership,sharedWorkspaceDatabase,assertProjectServing} from '../cloud/memberships.mjs';
const owner='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',actor='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const p='p-111111111111',q='p-222222222222',r='d-111111111111',s='d-222222222222';
const state={projects:[{id:p,name:'Shared',environment:[{value:'SECRET'}]},{id:q,name:'Hidden'}],releases:[{id:r,projectId:p,secrets:'SECRET'},{id:s,projectId:q}],logs:[{projectId:p,message:'visible'},{projectId:q,message:'hidden'}],sourceJobs:{j:{projectId:p},k:{projectId:q}}};
const store={state,project:id=>{const v=state.projects.find(p=>p.id===id);assert.ok(v);return v;},release:id=>{const v=state.releases.find(r=>r.id===id);assert.ok(v);return v;},save(){}};
const grant=role=>({actorId:actor,ownerId:owner,memberships:[{project_id:p,role}]});
const run=(role,method,path,body={})=>authorizeProjectRequest(store,grant(role),method,path,body);
test('Publisher allowed import, approve, publish and restore; Viewer reads only',()=>{
 for(const path of [`/api/projects/${p}/import`,`/api/releases/${r}/approve`,`/api/releases/${r}/publish-site`,`/api/projects/${p}/restore`]){assert.equal(run('publisher','POST',path).role,'publisher');assert.throws(()=>run('viewer','POST',path),{status:403});}
 assert.equal(run('viewer','GET',`/api/releases/${r}/readiness`).projectId,p);
});
test('Cross-project release/job/body spoofing rejected, including two valid memberships',()=>{
 for(const path of [`/api/releases/${s}/receipt`,'/api/source-jobs/k',`/api/projects/${q}/diagnostics`])assert.throws(()=>run('publisher','GET',path),{status:403});
 for(const body of [{releaseId:s},{projectId:q},{releaseIds:[r,s]}])assert.throws(()=>run('publisher','POST',`/api/projects/${p}/restore`,body),{status:403});
 assert.throws(()=>authorizeProjectRequest(store,{...grant('publisher'),memberships:[{project_id:p,role:'publisher'},{project_id:q,role:'publisher'}]},'POST',`/api/projects/${p}/restore`,{releaseId:s}),{status:403});
});
test('Unknown, credential/configuration, export and vendor routes denied by default',()=>{
 for(const [method,path] of [['GET','/api/oauth/status'],['GET',`/api/releases/${r}/export`],['POST',`/api/projects/${p}/sample`],['POST',`/api/projects/${p}/environment`],['POST','/api/connections'],['POST',`/api/projects/${p}/members`],['POST',`/api/projects/${p}/github-workflow`],['GET',`/api/projects/${p}/future-route`]])assert.throws(()=>run('publisher',method,path,{projectId:p}),{status:403});
});
test('Publisher cannot inject vendor build configuration',()=>{assert.throws(()=>run('publisher','POST',`/api/projects/${p}/github-build`,{buildCommand:'curl attacker.test'}),{status:403});});
test('State exposes only authorized project summaries/logs; nested secrets and account aggregates removed',()=>{
 const view=sharedState(store,grant('viewer').memberships),json=JSON.stringify(view);assert.equal(view.projects.length,1);assert.equal(view.releases.length,1);assert.equal(view.logs.length,1);assert.ok(!json.includes('Hidden')&&!json.includes('SECRET'));
 assert.deepEqual(memberResponse({archive:{bytes:1,accountBytes:9},nested:{secrets:'x',base64:'y',access_token:'z'}}),{archive:{bytes:1},nested:{}});
});
test('Revocation rejects next authorization; suspension blocks serving and authorization audit has actor',()=>{
 assert.throws(()=>authorizeProjectRequest(store,{...grant('publisher'),memberships:[]},'POST',`/api/projects/${p}/import`),{status:403});
 assert.throws(()=>assertNotSuspended({suspended:true,reason:'abuse'}),{status:423});assertNotSuspended({suspended:false});
 auditAuthorization(store,actor,p,'POST',`/api/projects/${p}/import`);assert.equal(state.accessAudit.at(-1).actorId,actor);
});
test('Membership lookup re-reads each request; shared persistence uses scoped RPC only',async t=>{
 const calls=[],env={SUPABASE_URL:'https://db.test',SUPABASE_ADMIN_KEY:'admin'};let revoked=false;
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});if(url.includes('shared_workspace'))return Response.json([{payload:'cipher',version:1}]);if(url.includes('project_status'))return Response.json([{suspended:true,reason:'stop'}]);return Response.json(revoked?[]:[{project_id:p,role:'publisher'}]);});
 assert.equal((await listMemberships(env,actor,owner)).length,1);revoked=true;assert.equal((await listMemberships(env,actor,owner)).length,0);
 await sharedWorkspaceDatabase(env,actor,owner);const rpc=calls.at(-1);assert.ok(rpc.url.endsWith('/rpc/tapenow_shared_workspace'));assert.equal(JSON.parse(rpc.init.body).target_owner,owner);assert.equal(JSON.parse(rpc.init.body).target_actor,actor);
 await assert.rejects(assertProjectServing(env,owner,p),{status:423});
 await assert.rejects(manageMembership(env,{id:actor},owner,p,'POST',{}),{status:403});
});
test('Shared persistence binds encryption to owner and never uses member JWT for owner table access',async t=>{
 const {randomBytes,generateKeyPairSync}=await import('node:crypto');const {seal,unseal}=await import('../cloud/security.mjs');const {emptyState}=await import('../server/core.mjs');const {openWorkspace}=await import('../cloud/persistence.mjs');
 const keys=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}),key=randomBytes(32).toString('base64');
 const env={SUPABASE_URL:'https://db.test',SUPABASE_ADMIN_KEY:'admin',VAULT_KEY:key,SIGNING_PRIVATE_KEY:keys.privateKey,SIGNING_PUBLIC_KEY:keys.publicKey,ARTIFACTS:{}};let row={payload:seal(emptyState(),key,'workspace:'+owner),version:1};let count=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{assert.ok(url.endsWith('/rpc/tapenow_shared_workspace'));assert.equal(init.headers.Authorization,'Bearer admin');const input=JSON.parse(init.body);assert.equal(input.target_actor,actor);assert.equal(input.target_owner,owner);if(input.next_payload){assert.equal(input.expected_version,row.version);row={payload:input.next_payload,version:row.version+1};}count++;return Response.json([row]);});
 const workspace=await openWorkspace(env,{id:owner},'member-jwt',{actorId:actor});workspace.store.state.preferences.test=true;workspace.store.save();await workspace.commit();assert.equal(count,2);assert.equal(unseal(row.payload,key,'workspace:'+owner).preferences.test,true);assert.throws(()=>unseal(row.payload,key,'workspace:'+actor));
});
test('P0 data/ecosystem roles allow safe reads and publisher actions, retaining owner-only vendors',()=>{
 for(const path of [`/api/projects/${p}/data-connections`,`/api/projects/${p}/ecosystem`,`/api/releases/${r}/dependencies`,'/api/ecosystem/health'])assert.equal(run('viewer','GET',path).owner,false);
 assert.equal(run('publisher','PUT',`/api/releases/${r}/dependencies`,{declarations:[]}).role,'publisher');assert.throws(()=>run('viewer','PUT',`/api/releases/${r}/dependencies`,{declarations:[]}),{status:403});
 for(const action of ['container/resolve','chain-import'])assert.equal(run('publisher','POST',`/api/projects/${p}/${action}`).role,'publisher');
 for(const action of ['postgres/production','business-api/preview','cloudflare/zones'])assert.throws(()=>run('publisher','GET',`/api/projects/${p}/${action}`),{status:403});
 assert.deepEqual(memberResponse({connections:[{provider:'postgres',environment:'production',secrets:'x'}]},{allowConnections:true}),{connections:[{provider:'postgres',environment:'production'}]});
});
test('Owner domain and connection mutations resolve project for suspension checks',()=>{
 state.domains=[{id:'dom-1',projectId:p}];state.connections={'connection-key':{projectId:p}};
 const ownerContext={actorId:owner,ownerId:owner};assert.equal(authorizeProjectRequest(store,ownerContext,'POST','/api/domains/dom-1/dns-apply',{}).projectId,p);
 assert.equal(authorizeProjectRequest(store,ownerContext,'DELETE','/api/connections/connection-key',{}).projectId,p);
 assert.throws(()=>run('publisher','POST','/api/domains/dom-1/dns-apply',{}),{status:403});
});
test('Shared UI contracts retain required arrays/source and redact readiness configuration values',()=>{
 state.releases[0].files=[{path:'index.html',bytes:12,base64:'SECRET'}];state.releases[0].source={type:'github',repository:'team/site',commit:'abc',token:'SECRET'};
 const view=sharedState(store,grant('viewer').memberships);assert.equal(view.releases[0].files.length,1);assert.equal(view.releases[0].source.type,'github');assert.ok(Array.isArray(view.projects[0].environment));assert.ok(Array.isArray(view.releases[0].transactions));assert.ok(!JSON.stringify(view).includes('SECRET'));
 const ready=memberResponse({configuration:{environment:[{value:'SECRET',reference:'SECRET'}],connections:[{reference:'SECRET'}],chain:{cpuIndex:'1'},domains:[]},previousConfiguration:null});assert.deepEqual(ready.configuration.environment,[]);assert.deepEqual(ready.configuration.connections,[]);assert.equal(ready.previousConfiguration,null);assert.equal(run('viewer','GET','/api/keys').owner,false);
});

test('operator maintenance allowance applies only to their own workspace and stays bounded',async()=>{
 const {workspaceMutationLimit}=await import('../cloud/access.mjs');
 const env={OPERATOR_EMAILS:'operator@example.test',DAILY_MUTATIONS:'300',OPERATOR_DAILY_MUTATIONS:'1800'},user={id:actor,email:'operator@example.test'};
 assert.equal(workspaceMutationLimit(env,user,actor),1800);
 assert.equal(workspaceMutationLimit(env,user,owner),300);
 assert.equal(workspaceMutationLimit(env,{...user,email:'member@example.test'},actor),300);
 for(const invalid of ['0','Infinity','20000','NaN'])assert.equal(workspaceMutationLimit({...env,OPERATOR_DAILY_MUTATIONS:invalid},user,actor),300);
});
