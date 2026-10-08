import React,{useState} from 'react';
import {api,getCapabilities} from './api';
import {Notice,Badge,External} from './ui';
import {t,useLanguage,translateMessage,localeDate} from './i18n';
import type {Release} from './types';
export function OperationsPanel(){
 useLanguage();const [records,setRecords]=useState<any[]|null>(null),[error,setError]=useState('');
 async function load(){try{const data=await api('/operations');setRecords(data.items);setError('');}catch(e){setError((e as Error).message);}}
 return <details className="panel p0-panel" onToggle={e=>{if(e.currentTarget.open&&!records)void load();}}><summary>{t('最近操作与重试状态')}</summary><p>{t('若操作中断，请先核对这里和部署列表。不会自动重复签署或发送交易。')}</p><button className="button secondary" onClick={()=>void load()}>{t('刷新操作记录')}</button>{records?.slice(0,20).map(r=><div className="batch-row" key={r.id}><div><strong>{r.status==='complete'?r.httpStatus<400?t('已完成'):t('失败'):t('需要核对')}</strong><p>{localeDate(r.at)} · {r.kind}</p></div>{r.projectId&&<a className="text-button" href={'#/'+r.projectId+'/deployments'}>{t('查看部署')}</a>}</div>)}{records?.length===0&&<p>{t('暂无操作记录')}</p>}{error&&<p role="alert">{translateMessage(error)}</p>}</details>;
}
export function BetaNotice(){
 useLanguage();const c=getCapabilities();if(c?.phase!=='A')return null;
 return <Notice><strong>{t('A 公测 · 发布到您选择的入口')}</strong><p>{t('在这里导入、预览、上链、更新和恢复。正式访问使用 TapeKit、BSC HashPort 或您自己的 Cloudflare。私有预览最长 24 小时；现有托管项目继续保留。')}</p>{c.usage&&<p>{c.plan==='free'&&<>{t('免费版')} · {t('项目')} {c.usage.projects} / {c.usage.limits.projects} · {t('版本')} {c.usage.archives} / {c.usage.limits.releases} · {c.usage.monthlyPublications&&<>{t('本月成功发布')} {c.usage.monthlyPublications.successful} / {c.usage.monthlyPublications.limit} ({t('待核验占位')} {c.usage.monthlyPublications.pending}) · </>}</>}{t('今日剩余操作')} {c.usage.remainingOperations} / {c.usage.dailyLimit} · {t('归档用量')} {(c.usage.archiveBytes/1048576).toFixed(1)} / {Math.round(c.usage.limits.archiveBytes/1048576)} MiB</p>}<a href="/docs/beta-a.html" target="_blank" rel="noreferrer">{t('公测使用范围与额度')}</a></Notice>;
}
export function NativeAccessPanel({release:r,readOnly,onChange}:{release:Release;readOnly:boolean;onChange:()=>Promise<void>}){
 useLanguage();const [challenge,setChallenge]=useState<any>(null),[checks,setChecks]=useState([false,false,false]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function action(work:()=>Promise<void>){setBusy(true);setError('');try{await work();await onChange();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(r.chainStatus!=='verified')return null;
 return <section className="panel p0-panel" id="native-access" tabIndex={-1}><div className="panel-heading"><h2>{t('检查正式访问网址')}</h2><Badge>{r.nativeAccess?.status==='observed'?t('已记录浏览器检查'):t('等待检查')}</Badge></div>
 <p>{t('链上文件已核验。请打开 TapeKit 原生网址，确认显示的是这个版本，并试一下图片、链接和主要交互。此处记录您的浏览器观察，不代替链上内容证明。')}</p>
 {r.nativeAccess?.status==='observed'&&<External href={r.nativeAccess.url}>{t('打开已确认的网址')}</External>}
 <button className="button secondary" disabled={busy||readOnly||!r.activation?.live} onClick={()=>void action(async()=>{setChecks([false,false,false]);setChallenge(await api('/releases/'+r.id+'/native-access/prepare',{}));})}>{t('准备浏览器检查')}</button>
 {challenge&&<div className="modal-form"><External href={challenge.url}>{t('打开原生网址检查')}</External>{[t('我已打开原生网址'),t('图片和主要交互正常'),t('显示的内容是这个版本')].map((label,i)=><label className="checkbox-label" key={label}><input type="checkbox" checked={checks[i]} onChange={e=>setChecks(checks.map((v,j)=>j===i?e.target.checked:v))}/>{label}</label>)}<button className="button primary" disabled={busy||readOnly||!checks.every(Boolean)} onClick={()=>void action(async()=>{await api('/releases/'+r.id+'/native-access/confirm',{checkId:challenge.checkId,opened:checks[0],assetsLoaded:checks[1],expectedVersion:checks[2]});setChallenge(null);})}>{t('记录检查并完成发布')}</button></div>}
 {error&&<p role="alert">{translateMessage(error)}</p>}</section>;
}
// D35: publishing on-chain needs several wallet signatures and a long upload, so
// phones get a recommendation, not a block. Touch-first or narrow screens only.
export function MobileChainNotice(){
 useLanguage();
 const mobile=typeof window!=='undefined'&&(window.matchMedia?.('(pointer: coarse)').matches||window.innerWidth<768);
 if(!mobile)return null;
 return <Notice><strong>{t('链上发布请用电脑浏览器')}</strong><p>{t('链上发布需要多次钱包签名和较长的上传时间，手机上更容易中断。您仍可以继续；如果中断，回到这里可以接着核对，不会自动重复发送交易。')}</p></Notice>;
}
