import { t, useLanguage, translateMessage } from "./i18n";
import {useEffect,useState} from 'react';
import {api,date} from './api';
import type {Project} from './types';
import {Badge,External,Notice} from './ui';
export function RuntimePanel({project}:{project:Project}) {
 useLanguage();
 const [rows,setRows]=useState<any[]>([]),[source,setSource]=useState(''),[filename,setFilename]=useState(''),[confirmed,setConfirmed]=useState(false),[includeSecrets,setIncludeSecrets]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const load=async()=>setRows(await api('/projects/'+project.id+'/runtime'));
 useEffect(()=>{void load().catch(e=>setError(e.message));},[project.id]);
 async function run(name:string,fn:()=>Promise<unknown>){setBusy(name);setError('');try{await fn();await load();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
 return <section className="panel source-panel"><div className="panel-heading"><h2>{t("动态运行时")}</h2><Badge>Cloudflare Workers</Badge></div><p className="muted">{t("服务器生成页面、API 和秘密配置运行在你连接的 Cloudflare 账户。静态网页仍可单独发布到链上。")}</p>
  <Notice>{t("首版支持已经打包好的单文件 Worker（ES Module，256 KiB 以内），或下方自带的 SSR + API 样例。Next.js、Server Actions、ISR 与其他供应商服务需要先适配，不会自动迁移。运行用量计入目标 Cloudflare 账户。")}</Notice>
  {error&&<p className="oauth-error" role="alert">{translateMessage(error)}</p>}
  <div className="source-build-fields"><label>{t("上传编译后的 Worker")}<input type="file" accept=".js,.mjs" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>256*1024){setError(t("文件超过 256 KiB"));return;}setSource(await f.text());setFilename(f.name);}}/></label></div>
  <p>{filename || t("未选择文件，可以先试运行内置样例。")}</p>
  <label className="source-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{t("我确认部署到此项目 Preview 环境所连接的 Cloudflare 账户，开启独立公开链接。")}</label>
  <label className="source-confirm"><input type="checkbox" checked={includeSecrets} onChange={e=>setIncludeSecrets(e.target.checked)}/>{t("将 Preview 环境中的秘密配置同步到这个 Worker。")}</label>
  <div className="button-row"><button className="button primary" disabled={project?.role==='viewer'||(!!busy||!confirmed)} onClick={()=>void run(t("部署样例"),()=>api('/projects/'+project.id+'/runtime',{sample:true,confirmed,includeSecrets}))}>{t("部署 SSR + API 样例")}</button><button className="button secondary" disabled={project?.role==='viewer'||(!!busy||!confirmed||!source)} onClick={()=>void run(t("部署 Worker"),()=>api('/projects/'+project.id+'/runtime',{source,confirmed,includeSecrets}))}>{t("部署")}{filename || 'Worker'}</button></div>
  {busy&&<p role="status">{busy}…</p>}
  {rows.map(r=><article className="source-job" key={r.id}><div><strong>{r.name}</strong><Badge>{r.status}</Badge></div><p>{date(r.createdAt)} · {r.bytes} {t("字节 · SHA-256")}{r.sha256.slice(0,12)}…</p>{r.error&&<p role="alert">{translateMessage(r.error)}</p>}<div className="button-row"><External href={r.url}>{t("打开运行时")}</External><button className="text-button" disabled={project?.role==='viewer'||(!!busy)} onClick={()=>void run(t("验证运行时"),()=>api('/projects/'+project.id+'/runtime/'+r.id+'/verify',{}))}>{r.sample?t("检查首页与 API"):t("检查首页")}</button></div></article>)}
 </section>;
}
