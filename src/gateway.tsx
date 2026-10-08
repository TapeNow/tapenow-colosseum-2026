import React,{useEffect,useState} from 'react';
import {Globe,ShieldCheck,RefreshCw,ExternalLink} from 'lucide-react';
import {api,bytes,getWorkspace,canHost} from './api';
import {Badge,Notice} from './ui';
import {t,useLanguage,translateMessage,localeDate,statusLabel} from './i18n';
import {network} from './chains';
import type {Project,Release,Domain} from './types';
import './gateway.css';

export function GatewayPanel({project,release,onChange}:{project:Project;release?:Release;onChange:()=>Promise<void>}){
  useLanguage();const [data,setData]=useState<any>(null),[challenge,setChallenge]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const load=async()=>setData(await api('/projects/'+project.id+'/gateway'));
  useEffect(()=>{setChallenge(null);void load().catch(e=>setError(e.message));},[project.id,release?.id,project.chain?.chainId,project.chain?.cpuIndex,project.chain?.tokenId]);
  async function action(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();await onChange();await load();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  const readOnly=project.role==='viewer',site=data?data.site:project.gateway,old=(release as any)?.gateway,restore=site&&old&&old.status!=='retired'&&site?.releaseId!==release?.id;
  async function wallet(){const w=(window as any).okxwallet||(window as any).ethereum;if(!w)throw Error(t('请先安装或打开钱包'));const accounts=await w.request({method:'eth_requestAccounts'});if(!accounts?.[0])throw Error(t('钱包未连接'));return {provider:w,address:accounts[0]};}
  if(!canHost(project.id))return <section className="panel p0-panel gateway-panel" id="gateway-publish"><h2>TapeNow Gateway</h2><Notice>{t('A 公测使用官方或客户自有入口；平台长期托管将在受控试用阶段开放。')}</Notice></section>;
  return <section className="panel p0-panel gateway-panel" id="gateway-publish"><div className="panel-heading"><h2><Globe size={18}/> TapeNow Gateway</h2><Badge tone={site?.status==='active'?'teal':'neutral'}>{site?statusLabel(site.status):t('尚未发布')}</Badge></div>
    <p>{t('把已上链的网站接入普通 HTTPS 入口。两个独立 RPC 核验全部文件后，再发布固定版本；访客无需钱包或 gas。')}</p>
    <p className="muted small-text">{t('稳定入口和自定义域名跳转到独立版本网址，避免新旧资源混用。当前固定版本不会自动跟随链上修改；新版本需重新确认。')}</p>
    {data&&!data.configured&&<Notice>{t('当前环境尚未启用 Gateway。现有 TapeKit 和预览入口仍可使用。')}</Notice>}
    {data?.pending&&<Notice><p>{t('上次发布结果尚未同步到项目记录。先恢复记录，避免重复发布。')}</p><button className="button secondary" disabled={busy||readOnly||!!getWorkspace()} onClick={()=>void action(async()=>{await api('/projects/'+project.id+'/gateway/recover',{});})}>{t('恢复网关发布记录')}</button></Notice>}
    {release&&<div className="button-row"><button className="button secondary" disabled={busy||readOnly||!data?.configured} onClick={()=>void action(async()=>{const w=await wallet();setChallenge(await api('/releases/'+release.id+'/gateway/prepare',{wallet:w.address}));})}><ShieldCheck size={15}/>{t('核对持有人与发布目标')}</button>
    {challenge&&<button className="button primary" disabled={busy||readOnly||challenge.expiresAt<Date.now()} onClick={()=>void action(async()=>{const w=await wallet();if(w.address.toLowerCase()!==challenge.wallet.toLowerCase())throw Error(t('钱包已切换，请重新核对目标'));const hex='0x'+Array.from(new TextEncoder().encode(challenge.message)).map(b=>b.toString(16).padStart(2,'0')).join('');const signature=await w.provider.request({method:'personal_sign',params:[hex,w.address]});await api('/releases/'+release.id+(restore?'/gateway/restore':'/gateway/publish'),{challengeId:challenge.id,signature});setChallenge(null);})}>{busy?t('正在核验与发布…'):restore?t('签名并恢复此网关版本'):t('签名并发布 Gateway')}</button>}</div>}
    {restore&&<Notice>{t('这是历史网关版本。恢复会切换稳定网址和客户域名，保持当时的固定文件；不会回退链上容器或业务数据库。')}<button className="text-button" disabled={busy||readOnly||!!getWorkspace()} onClick={()=>void action(async()=>{await api('/releases/'+release!.id+'/gateway/retire',{});setChallenge(null);})}>{t('停用此旧版网关缓存')}</button></Notice>}
    {challenge&&<div className="gateway-challenge"><p>{network(challenge.target.chainId).name} · CPU {challenge.target.cpuIndex} / NFT {challenge.target.tokenId}</p><p>{t('仅签署归属证明，不发送链上交易。请先在上方完成发布检查。')}</p><details><summary>{t('查看签名内容')}</summary><pre>{challenge.message}</pre></details></div>}
    {site&&<><dl className="gateway-facts"><div><dt>{t('读取网络')}</dt><dd>{network(site.target.chainId).name}</dd></div><div><dt>{t('文件与体积')}</dt><dd>{site.files?.length||0} · {bytes(site.bytes||0)}</dd></div><div><dt>{t('文件核验区块')}</dt><dd>{site.blockNumber}</dd></div><div><dt>{t('最近归属检查')}</dt><dd>{site.checkedAt?localeDate(site.checkedAt):'—'}</dd></div></dl>
    <div className="gateway-links">{[[t('稳定入口'),site.stableUrl],[t('固定版本'),site.versionUrl],[t('核验清单'),site.manifestUrl],[t('TapeKit 原生入口'),site.nativeUrl]].filter(([,url])=>url).map(([label,url])=><a key={label} className="text-button" href={url} target="_blank" rel="noreferrer">{label}<ExternalLink size={13}/></a>)}</div>
    <button className="button secondary" disabled={busy||readOnly||!!getWorkspace()} onClick={()=>void action(async()=>{await api('/projects/'+project.id+'/gateway/check',{content:true});})}><RefreshCw size={14}/>{t('检查归属与链上更新')}</button>
    {site.contentCheck&&<Notice>{site.contentCheck.status==='changed'?t('发现链上新内容。当前入口继续使用已批准的固定版本；请导入新内容、确认并发布。'):site.contentCheck.status==='unchanged'?t('链上文件与当前固定版本一致。'):t('本次无法完成内容核验，旧记录不代表当前链上状态。')}</Notice>}
    {site.status!=='active'&&<Notice>{translateMessage(site.error||'网关归属检查需要重试')}</Notice>}</>}
    <p className="muted small-text">{t('这是由网关提供的核验与访问服务；原生 TapeKit 入口仍可独立读链。暂停项目会停止 TapeNow 网关入口，不能删除链上副本。')}</p>
    <a className="text-button" href="/docs/gateway.html" target="_blank" rel="noreferrer">{t("Gateway 使用指南")}<ExternalLink size={13}/></a>
    {error&&<p role="alert" className="release-error">{translateMessage(error)}</p>}
  </section>;
}
export function GatewayDomain({domain,onChange,readOnly=false}:{domain:Domain;onChange:()=>Promise<void>;readOnly?:boolean}){
  useLanguage();const [busy,setBusy]=useState(false),[error,setError]=useState(''),[plan,setPlan]=useState<any>(null);const gateway=(domain as any).gateway;
  async function action(fn:()=>Promise<unknown>){setBusy(true);setError('');try{await fn();await onChange();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  return <div className="p0-domain"><Badge>TapeNow Gateway</Badge><p className="muted small-text">{t('先创建证书验证记录，再配置 DNS。域名控制权、HTTPS 证书与芯片归属全部通过后才启用入口。')}</p><div className="button-row">
    <button className="button secondary" disabled={busy||readOnly||gateway?.ready} onClick={()=>void action(()=>api('/domains/'+domain.id+'/gateway-prepare',{}))}>{t('准备域名与证书')}</button>
    <button className="button secondary" disabled={busy||readOnly||!gateway?.records} onClick={()=>void action(async()=>setPlan(await api('/domains/'+domain.id+'/dns-plan',{})))}>{t('检查 DNS 变更')}</button>
    {plan&&<button className="button primary" disabled={busy||readOnly} onClick={()=>void action(async()=>{await api('/domains/'+domain.id+'/dns-apply',{digest:plan.digest});setPlan(null);})}>{t('确认配置 DNS')}</button>}
    <button className="button secondary" disabled={busy||readOnly||!gateway?.cfId} onClick={()=>void action(()=>api('/domains/'+domain.id+'/gateway-check',{}))}>{t('核验并启用域名')}</button>
    {gateway?.cfId&&<button className="text-button" disabled={busy||readOnly} onClick={()=>void action(()=>api('/domains/'+domain.id+'/gateway-disconnect',{}))}>{t('断开网关域名')}</button>}
  </div>{gateway?.records&&<div className="gateway-records"><table className="p0-costs"><caption>{t('也可在自己的 DNS 服务商手动添加以下记录')}</caption><thead><tr><th>{t('类型')}</th><th>{t('名称')}</th><th>{t('目标')}</th></tr></thead><tbody>{(plan?.changes||gateway.records).map((r:any,i:number)=><tr key={i}><td>{r.type}</td><td><code>{r.name}</code></td><td><code>{r.content}</code></td></tr>)}</tbody></table></div>}
    {gateway?.sslStatus&&<p>{t('证书状态')}：{statusLabel(gateway.sslStatus)}</p>}{error&&<p className="release-error" role="alert">{translateMessage(error)}</p>}
  </div>;
}
