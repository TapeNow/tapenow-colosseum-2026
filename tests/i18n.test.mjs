import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import {extractCatalog,extractTree,migrateSource} from '../scripts/i18n-extract.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../src/locales/en.json',import.meta.url),'utf8'));
test('English source catalog covers the original 964-entry baseline and preserves template placeholders',()=>{
 for(const key of Object.keys(catalog)){assert.ok(catalog[key],key);assert.ok(!/\p{Script=Han}/u.test(catalog[key]),key);assert.deepEqual(catalog[key].match(/\{\d+\}/g)||[],key.match(/\{\d+\}/g)||[],key);}
 assert.ok(Object.keys(catalog).length>=964);
});
test('AST extraction normalizes JSX, preserves template expressions and excludes import/property identifiers',()=>{
 const items=extractCatalog('import x from "中文模块"; const x={"中文键":"说明"}; const y=`连接 ${name}`; const v=<p> 帮助\n 与指南 </p>;');
 assert.ok(items.some(x=>x.source==='帮助 与指南'));assert.ok(items.some(x=>x.source==='连接 {0}'));assert.ok(items.some(x=>x.source==='说明'));assert.ok(!items.some(x=>x.source==='中文键'||x.source==='中文模块'));
});
test('safe migration translates JSX and accessibility copy but preserves user data, identifiers and code',()=>{
 const source='const user={name:"用户名称"}; const code="示例代码"; const view=<button aria-label="保存" value="用户名称"> 保存 </button>';
 const out=migrateSource(source).source;assert.match(out,/aria-label=\{t\("保存"\)\}/);assert.match(out,/\{t\("保存"\)\}/);assert.ok(out.includes('name:"用户名称"'));assert.ok(out.includes('value="用户名称"'));assert.ok(out.includes('code="示例代码"'));assert.equal(migrateSource(out).changes,0);
});
test('runtime persists locale, interpolates, formats dates and preserves unknown text',async()=>{
 const old=globalThis.localStorage;let saved=null;globalThis.localStorage={getItem:()=>saved,setItem:(_,v)=>{saved=v;}};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tapenow-i18n-'));
 try{
  let source=fs.readFileSync(new URL('../src/i18n.tsx',import.meta.url),'utf8').replace("import english from './locales/en.json';",'const english='+JSON.stringify(catalog)+';');
  let js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  js=js.replace(/from ['"]react['"]/g,'from '+JSON.stringify(import.meta.resolve('react')));
  const file=path.join(dir,'i18n.mjs');fs.writeFileSync(file,js);const mod=await import(file);
  assert.equal(mod.t('保存'),'Save');assert.equal(mod.t('连接 {0}',['GitHub']),'Connect GitHub');assert.equal(mod.t('未知业务消息'),'未知业务消息');assert.match(mod.localeDate('2026-09-28T00:00:00Z',{year:'numeric'}),/2026/);
  saved='zh-CN';const chinese=await import(file+'?stored-zh');assert.equal(chinese.t('保存'),'保存');
  mod.setLanguage('zh-CN');assert.equal(saved,'zh-CN');assert.equal(mod.t('保存'),'保存');mod.setLanguage('en');assert.equal(saved,'en');
 }finally{globalThis.localStorage=old;fs.rmSync(dir,{recursive:true,force:true});}
});

test('public pages default to English, keep a saved Chinese choice, and honor explicit URL language',()=>{
 const files=['docs/manual/index.html','privacy.html','terms.html','docs/privacy.html','docs/terms.html','docs/integrations.html','docs/receipt-verification.html','docs/fees.html','docs/gateway.html','docs/beta-a.html','docs/webmcp.html'];
 for(const file of files){
  const html=fs.readFileSync(path.join('public',file),'utf8');
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length,file);
  const bootstrap=file==='docs/gateway.html'||file==='docs/beta-a.html'||file==='docs/webmcp.html'?scripts.at(-1)[1]:scripts[0][1];
  for(const [saved,search,expected] of [[null,'','en'],['zh-CN','','zh-CN'],['zh-CN','?lang=en','en'],[null,'?lang=zh-CN','zh-CN']]){
   const documentElement={lang:'en',dataset:{language:'en'}},elements=new Map(),document={documentElement,getElementById(id){if(!elements.has(id))elements.set(id,{value:'en',hidden:false});return elements.get(id);}};
   vm.runInNewContext(bootstrap,{URLSearchParams,location:{search},localStorage:{getItem:()=>saved,setItem(){}},document},{filename:file});
   assert.equal(documentElement.lang,expected,file+' saved='+saved+' search='+search);
   if(['docs/beta-a.html','docs/webmcp.html'].includes(file))assert.equal(elements.get('en').hidden,expected!=='en',file);
  }
 }
});

async function uiFixture(){
 const {build}=await import('esbuild');
 fs.mkdirSync('.omo/evidence/p0-data',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.omo/evidence/p0-data/ui-'));
 const file=path.join(dir,'ui.mjs');
 await build({stdin:{contents:`export * from './src/i18n.tsx';export * from './src/api.ts';export * from './src/guide.tsx';export * from './src/workspace.tsx';export * from './src/integrations.tsx';export * from './src/p0.tsx';export * from './src/ui.tsx';`,resolveDir:process.cwd(),loader:'tsx'},outfile:file,bundle:true,format:'esm',platform:'node',packages:'external',loader:{'.css':'empty'},logLevel:'silent'});
 const storage=new Map();globalThis.sessionStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};globalThis.localStorage=globalThis.sessionStorage;globalThis.window={addEventListener(){},dispatchEvent(){}};globalThis.location={hash:'',href:'https://app.tapenow.dev/'};
 return {mod:await import(file),dir,storage};
}
test('English rendered guides, integration pages, P0 panels and release lists have no stock Chinese and preserve user names',async()=>{
 const {createElement:h}=await import('react'),{renderToStaticMarkup:render}=await import('react-dom/server'),{mod,dir}=await uiFixture();
 const p={id:'p1',name:'保存',description:'用户描述',createdAt:'2026-09-28',updatedAt:'2026-09-28',productionId:null,chain:{chainId:56,cpuIndex:'1',tokenId:'2',container:''},environment:[],repository:null};
 const r={id:'r1',projectId:'p1',label:'预览',createdAt:'2026-09-28',bytes:2,source:{type:'upload'},files:[{path:'index.html',bytes:2,sha256:'a'.repeat(64)}],chainStatus:'draft',status:'archived',checks:[],transactions:[]};const data={projects:[p],releases:[r],connections:{},logs:[],domains:[],visits:[]},noop=()=>{};
 mod.setLanguage('en');
 const scenarios=[];
 for(const section of ['start','features','faq'])for(const topic of section==='features'?['import','preview','versions','services','chain','domains','settings']:['import'])scenarios.push(['guide-'+section+'-'+topic,h(mod.GuideCenter,{initialSection:section,initialTopic:topic,projects:[p],currentProject:p,onClose:noop,onAction:noop})]);
 scenarios.push(['integrations',h(mod.IntegrationsPage,{data,project:p,busy:false,onConnect:noop,onManage:noop,onDisconnect:noop,onChanged:noop,onCreate:noop})],['postgres',h(mod.PostgresPanel,{project:p})],['dependencies',h(mod.DependencyPanel,{release:r})],['ecosystem',h(mod.EcosystemPage,{project:p,data,onChange:async()=>{},onRelease:noop,wallet:''})],['costs',h(mod.CostSources,{project:p,data})],['deployments',h(mod.DeploymentList,{items:[r],data,onOpen:noop})]);
 const evidence=[];
 try{for(const [name,node] of scenarios){const html=render(node);fs.writeFileSync(path.join(dir,name+'.html'),html);const text=html.replace(/<[^>]*>/g,'').replaceAll('保存','').replaceAll('预览','').replaceAll('用户描述','');assert.ok(!/\p{Script=Han}/u.test(text),name+': '+text.match(/.{0,30}\p{Script=Han}.{0,50}/u)?.[0]);evidence.push(name+' PASS');}
  const list=render(h(mod.DeploymentList,{items:[r],data,onOpen:noop}));assert.ok(list.includes('预览'));assert.ok(list.includes('保存'));
  const en=render(h(mod.GuideCenter,{initialSection:'faq',projects:[p],onClose:noop,onAction:noop}));mod.setLanguage('zh-CN');const zh=render(h(mod.GuideCenter,{initialSection:'faq',projects:[p],onClose:noop,onAction:noop}));assert.ok(en.includes('Frequently asked'));assert.ok(zh.includes('常见问题'));assert.equal(mod.uiModel({label:'保存'}).label,'保存');mod.setLanguage('en');assert.equal(mod.uiModel({label:'保存'}).label,'Save');
  fs.writeFileSync('.omo/evidence/p0-data/i18n-render-scenarios.txt',evidence.join('\n')+'\nLocale change: English → Chinese → English PASS\nUser project/release names preserved PASS\nArtifacts: '+dir+'\n');
 }finally{delete globalThis.window;delete globalThis.location;delete globalThis.sessionStorage;delete globalThis.localStorage;}
});
test('HashPort browser readback enforces HTTPS URL, no redirects, byte count and hash; CORS remains failed',async()=>{
 const {mod}=await uiFixture();const bytes=new TextEncoder().encode('ok'),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),files=[{path:'index.html',bytes:2,sha256:hash}];let seen;
 const response=(url,body=bytes)=>{const r=new Response(body);Object.defineProperty(r,'url',{value:url});return r;};
 const good=await mod.verifyDomainManifest('site.example.com',files,{fetchImpl:async(url,options)=>{seen=options;return response(url);}});assert.equal(good.httpsVerified,true);assert.equal(seen.credentials,'omit');assert.equal(seen.cache,'no-store');assert.equal(seen.redirect,'error');
 for(const fetchImpl of [async()=>{throw Error('CORS');},async()=>response('https://other.example.com/index.html'),async url=>response(url,new TextEncoder().encode('bad')),async url=>response(url,new TextEncoder().encode('xx'))]){const result=await mod.verifyDomainManifest('site.example.com',files,{fetchImpl});assert.equal(result.httpsVerified,false);assert.deepEqual(result.failedPaths,['index.html']);}
 delete globalThis.window;delete globalThis.location;delete globalThis.sessionStorage;delete globalThis.localStorage;
});
test('complete dynamic messages preserve captured user text and shared selection clears between actors and logout',async()=>{
 const {mod,storage}=await uiFixture();mod.setLanguage('en');assert.equal(mod.translateMessage('已验证 3 个文件，归档已创建'),'Verified 3 files; archive created');assert.equal(mod.translateMessage('重复文件：用户文件.html'),'Duplicate file:用户文件.html');assert.equal(mod.translateMessage('未知供应商原文'),'未知供应商原文');
 let actor='actor-a',seenHeaders;const originalFetch=globalThis.fetch;globalThis.fetch=async(url,init)=>{seenHeaders=init?.headers;return Response.json(String(url).endsWith('/session')?{mode:'cloud',user:{id:actor},authenticated:true,token:'test'}:{});};
 try{await mod.initialize();mod.setWorkspace('owner-a');assert.equal(mod.getWorkspace(),'owner-a');actor='actor-b';await mod.initialize();assert.equal(mod.getWorkspace(),'');mod.setWorkspace('owner-b');await mod.api('/auth/logout',{});assert.equal(mod.getWorkspace(),'');assert.equal(seenHeaders['X-TapeNow-Workspace'],undefined);assert.equal(storage.get('tapenow-workspace'),'');}finally{globalThis.fetch=originalFetch;delete globalThis.window;delete globalThis.location;delete globalThis.sessionStorage;delete globalThis.localStorage;}
});
test('localized public documents contain full native sections and English sections have no Chinese prose',()=>{
 for(const file of ['privacy.html','terms.html','docs/privacy.html','docs/terms.html','docs/integrations.html','docs/receipt-verification.html']){const html=fs.readFileSync(path.join('public',file),'utf8'),en=html.slice(html.indexOf('<section class="locale-en" lang="en">')+36);assert.ok(html.includes('class="locale-zh" lang="zh-CN"'),file);assert.ok(html.includes('tapenow.language'),file);assert.ok(!/\p{Script=Han}/u.test(en),file);}
});
test('all stock Chinese source literals are translated at render or in a lazy source-only UI model',()=>{
 const unwrapped=[];for(const file of fs.readdirSync('src').filter(f=>/\.tsx?$/.test(f)&&f!=='i18n.tsx')){const ast=ts.createSourceFile(file,fs.readFileSync('src/'+file,'utf8'),ts.ScriptTarget.Latest,true);function walk(node){if((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isJsxText(node))&&/\p{Script=Han}/u.test(node.text)){let p=node.parent,wrapped=false;while(p){if(ts.isCallExpression(p)&&['t','translateMessage','uiModel'].includes(p.expression.getText(ast))){wrapped=true;break;}p=p.parent;}if(!wrapped)unwrapped.push(file+': '+node.text);}ts.forEachChild(node,walk);}walk(ast);}assert.deepEqual(unwrapped,[]);
});
test('private preview gate and errors select language without changing authentication or security headers',async(t)=>{
 const {projectStatusFixture}=await import('./project-status-fixture.mjs');const statusFixture=projectStatusFixture(t);
 const {generateKeyPairSync,randomBytes}=await import('node:crypto'),{createMemoryStore,parseFiles}=await import('../server/core.mjs'),{createPrivatePreview,servePrivate}=await import('../cloud/private-preview.mjs');
 const pair=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}),store=createMemoryStore({vaultKey:randomBytes(32),...pair}),project=store.createProject('Preview i18n'),release=store.createRelease(project.id,parseFiles({files:[{path:'index.html',base64:Buffer.from('<h1>site</h1>').toString('base64')}]}));
 const objects=new Map(),env={...statusFixture.env,ARTIFACTS:{put:async(k,v)=>objects.set(k,v),get:async k=>objects.has(k)?{json:async()=>JSON.parse(objects.get(k)),body:objects.get(k)}:null},VAULT_KEY:randomBytes(32).toString('base64'),SITE_DOMAIN:'test.invalid',SITE_DNS_READY:'true'},made=await createPrivatePreview(env,store,{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},release,{hours:1});
 const en=await servePrivate(new Request(made.url+'/?lang=en'),env,release.id),html=await en.text();assert.equal(en.status,401);assert.ok(html.includes('<h1>Private preview</h1>'));assert.ok(html.includes('/__tapenow/unlock?lang=en'));assert.match(en.headers.get('Content-Security-Policy'),/worker-src 'none'/);assert.match(en.headers.get('Cache-Control'),/no-store/);fs.writeFileSync('.omo/evidence/p0-data/private-preview-en.html',html);
 const wrong=await servePrivate(new Request(made.url+'/__tapenow/unlock?lang=en',{method:'POST',headers:{Origin:made.url,'Content-Type':'application/json'},body:JSON.stringify({password:'incorrect-password'})}),env,release.id);assert.equal(wrong.status,403);assert.match(await wrong.text(),/Incorrect password/);
 const expired=await servePrivate(new Request(made.url+'/',{headers:{'Accept-Language':'en-US,en;q=0.9'}}),env,release.id,{time:Date.now()+7200000});assert.equal(expired.status,410);assert.match(await expired.text(),/expired/);
 const zh=await servePrivate(new Request(made.url+'/?lang=zh-CN'),env,release.id);assert.ok((await zh.text()).includes('<h1>私有预览</h1>'));
 const defaultPage=await servePrivate(new Request(made.url+'/'),env,release.id);assert.ok((await defaultPage.text()).includes('<h1>Private preview</h1>'));
});
