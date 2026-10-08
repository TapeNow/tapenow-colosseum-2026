import {getCapabilities} from './api';
import { t, useLanguage, translateMessage } from "./i18n";
import {useEffect,useState} from 'react';
import {api,bytes,date,getSession,isCloud} from './api';
import {Badge,External,Notice} from './ui';
import type {Project,Release,State} from './types';
import './batch2.css';

function useOperation(){const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);return {busy,message,failed,run:async(fn:()=>Promise<unknown>,success=t("已保存"))=>{setBusy(true);setMessage('');try{await fn();setFailed(false);setMessage(success);}catch(e){setFailed(true);setMessage((e as Error).message);}finally{setBusy(false);}}};}
const Feedback=({op}:{op:ReturnType<typeof useOperation>})=>op.message?<p className={'batch-feedback '+(op.failed?'error':'')} role={op.failed?'alert':'status'}>{translateMessage(op.message)}</p>:null;

export function InvitationPage(){
 useLanguage();
  const op=useOperation(),[items,setItems]=useState<any[]>([]),[email,setEmail]=useState(''),[reinvite,setReinvite]=useState(false);
  const load=async()=>setItems((await api('/invitations')).items);useEffect(()=>{void op.run(load,'');},[]);
  if(!getSession().operator)return <Notice>{t("只有平台维护者可以管理邀请。普通用户的项目与授权保持独立。")}</Notice>;
  return <div className="batch-page"><div className="page-heading"><div><h1>{t("邀请用户")}</h1><p>{t("邀请新的 TapeNow 账号。每个人拥有独立的工作空间。")}</p></div><button className="button secondary" disabled={op.busy} onClick={()=>void op.run(load,t("已刷新"))}>{t("刷新状态")}</button></div>
    <section className="panel batch-card"><h2>{t("发送邀请")}</h2><p>{t("邀请七天内有效。邮件包含登录验证码，接受邀请后可以持续使用；撤销会阻止该邮箱后续访问。")}</p>
      <form className="batch-form" onSubmit={e=>{e.preventDefault();void op.run(async()=>{await api('/invitations',{email,reinvite});await load();},t("已交给邮件服务发送。实际送达以收件人收到邮件为准。"));}}>
        <label>{t("受邀邮箱")}<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
        <label className="batch-check"><input type="checkbox" checked={reinvite} onChange={e=>setReinvite(e.target.checked)}/>{t("重新开放此前已撤销的邮箱")}</label>
        <button className="button primary" disabled={op.busy}>{op.busy?t("处理中…"):t("发送邀请 / 重发")}</button>
      </form><Feedback op={op}/>
    </section>
    <section className="panel"><div className="panel-heading"><h2>{t("邀请记录")}</h2><Badge>{items.length} {t("/ 最近 200 条")}</Badge></div><div className="batch-list">{!items.length&&<p className="muted">{t("尚无邀请记录。已有测试白名单账号继续可用。")}</p>}{items.map(i=><article className="batch-row" key={i.email}><div><strong>{i.email}</strong><p><Badge tone={i.status==='active'?'teal':'neutral'}>{i.status==='active'?t("已接受"):i.status==='revoked'?t("已撤销"):Date.parse(i.expires_at)<Date.now()?t("已过期"):t("等待接受")}</Badge> · {i.delivery==='failed'?t("邮件发送失败"):i.delivery==='accepted'?t("邮件请求已接受"):t("等待发送")}</p><small className="muted">{t("邀请有效期至")}{date(i.expires_at)}</small></div><button className="button secondary" disabled={op.busy||i.status==='revoked'} onClick={()=>void op.run(async()=>{await api('/invitations/revoke',{email:i.email});await load();},t("邀请已撤销，下一次访问将拒绝"))}>{t("撤销访问")}</button></article>)}</div></section>
    <Notice>{t("这是平台使用资格，不是项目协作邀请；不会让受邀人看到你的项目。撤销也不会删除其供应商账号、数据库或链上文件。")}</Notice>
  </div>;
}

export function FirstUse({data,onCreate,onGuide,onChanged}:{data:State;onCreate:()=>void;onGuide:()=>void;onChanged:()=>Promise<unknown>}) {
 useLanguage();
  const op=useOperation();if(data.preferences?.onboardingDismissed)return null;
  return <section className="panel batch-card batch-welcome"><div><Badge tone="teal">{t("开始使用")}</Badge><h2>{t("先把一个作品放进来")}</h2><p>{t("导入构建文件 → 用密码分享给朋友 → 确认文件与配置 → 选择正式发布。连接供应商和钱包可以稍后再做。")}</p><div className="button-row"><button className="button primary" onClick={onCreate}>{t("创建项目")}</button><button className="button secondary" onClick={onGuide}>{t("查看发布指南")}</button><button className="text-button" disabled={op.busy} onClick={()=>void op.run(async()=>{await api('/onboarding',{dismissed:true},'PATCH');await onChanged();})}>{t("知道了")}</button></div><Feedback op={op}/></div><ol><li>{t("免费导入，先验证产物")}</li><li>{t("预览有密码与有效期")}</li><li>{t("链上发布前另行确认预算")}</li></ol></section>;
}

export function PrivatePreviewPanel({release:r,onChanged}:{release:Release;onChanged:()=>Promise<unknown>}) {
 useLanguage();
  const op=useOperation(),[hours,setHours]=useState(24),[password,setPassword]=useState(''),[publicConsent,setConsent]=useState(false);
  const privateEnabled=getSession().siteEnabled===true,active=r.privatePreview?.status==='active'&&Date.parse(r.privatePreview.expiresAt)>Date.now(),preparing=r.privatePreview?.status==='preparing',exposed=!!(r.publicExposure||r.preview?.url||r.site?.url||r.cloudflare?.url||r.cloudflareProduction?.url||r.transactions.length),available=!r.archive?.state||r.archive.state==='available';
  if(!isCloud())return null;
  return <section className="panel batch-card"><div className="batch-title"><h2>{t("预览与访问")}</h2><Badge tone={active?'teal':'neutral'}>{preparing?t("预览创建待完成"):active?t("密码保护"):exposed?t("曾发起公开发布"):t("仅归档")}</Badge></div>
    <p>{t("新版本默认仅保存文件。私有预览使用独立网址；密码不会保存在项目记录或日志中。到期和撤销会拒绝后续请求，已经下载的副本无法收回。")}</p>
    {r.privatePreview&&<div className="batch-row"><div><strong>{preparing?t("创建未完成，可重新生成或撤销 · "):active?t("预览有效期至 "):t("预览已过期或撤销 · ")}{date(r.privatePreview.expiresAt)}</strong><p className="batch-url">{r.privatePreview.url}</p></div><div className="button-row">{!preparing&&<External href={r.privatePreview.url}>{t("打开预览")}</External>}{['active','preparing'].includes(r.privatePreview.status)&&<button className="button secondary" disabled={op.busy} onClick={()=>void op.run(async()=>{await api('/releases/'+r.id+'/private-preview/revoke',{});setPassword('');await onChanged();},t("预览已撤销"))}>{t("撤销")}</button>}</div></div>}
    {!privateEnabled&&<Notice>{t("此环境尚未配置私有预览域名。正式站 app.tapenow.dev 已支持；本环境可明确确认创建公开预览。")}</Notice>}
    {privateEnabled&&!exposed&&available&&<div className="batch-form"><label>{t("有效期")}<select value={hours} onChange={e=>setHours(Number(e.target.value))}><option value={1}>{t("1 小时")}</option><option value={24}>{t("24 小时")}</option>{getCapabilities()?.phase!=='A'&&<><option value={72}>{t("3 天")}</option><option value={168}>{t("7 天")}</option></>}</select></label><button className="button primary" disabled={op.busy} onClick={()=>void op.run(async()=>{const result=await api('/releases/'+r.id+'/private-preview',{hours});setPassword(result.password);await onChanged();},t("私有预览已生成；请保存下面的密码"))}>{active?t("重新生成并使旧密码失效"):t("创建私有预览")}</button></div>}
    {password&&<div className="batch-secret"><strong>{t("预览密码（只在本次页面显示）")}</strong><code>{password}</code><button className="button secondary" onClick={()=>void op.run(()=>navigator.clipboard.writeText(password),t("已复制预览密码"))}>{t("复制密码")}</button></div>}
    {exposed&&<Notice>{t("这个版本曾发起公开发布，可能已有公开副本，不能变回保密版本。需要私有预览时，请导入新的未公开版本。")}</Notice>}
    {getCapabilities()?.phase!=='A'&&!r.preview?.url&&available&&!active&&!preparing&&<details><summary>{t("创建公开预览")}</summary><label className="batch-check"><input type="checkbox" checked={publicConsent} onChange={e=>setConsent(e.target.checked)}/>{t("我确认所有文件将公开，并且公开副本不能靠撤销密码预览收回。")}</label><button className="button secondary" disabled={op.busy||!publicConsent} onClick={()=>void op.run(async()=>{await api('/releases/'+r.id+'/preview',{acknowledgePublic:true});setPassword('');await onChanged();},t("公开预览已创建"))}>{t("发布公开 Pages 预览")}</button></details>}
    <Feedback op={op}/>
  </section>;
}

export function DataHealth({project,onChanged}:{project:Project;onChanged:()=>Promise<unknown>}) {
 useLanguage();
  const op=useOperation(),[report,setReport]=useState<any>(null),[tokens,setTokens]=useState<Record<string,string>>({}),[consent,setConsent]=useState(false);
  const load=async()=>setReport(await api('/projects/'+project.id+'/data-health'));
  useEffect(()=>{void op.run(load,'');},[project.id]);
  return <section className="panel batch-card"><div className="batch-title"><h2>{t("环境隔离与邮件验收")}</h2><button className="button secondary" disabled={project?.role==='viewer'||(op.busy)} onClick={()=>void op.run(load,t("连接已重新检查"))}>{t("检查连接")}</button></div>
    <p>{!report?t("正在检查数据库连接…"):report.isolation==='separate'?t("预览与生产连接了不同的数据库。"):report?.isolation==='shared'?t("注意：两个环境连接同一个数据库，测试写入会影响正式数据。"):t("请分别连接预览与生产数据库。")}{t("连接不会自动复制数据、执行 SQL 或改写已有构建。")}</p>
    <div className="batch-grid">{report?.environments.map((env:any)=><article className="batch-subcard" key={env.environment}><h3>{env.environment==='preview'?t("预览环境"):t("生产环境")} <Badge tone={env.status==='reachable'?'teal':'neutral'}>{env.status==='reachable'?t("Auth API 可达"):t("尚未连接")}</Badge></h3>
      {env.error?<p>{translateMessage(env.error)}</p>:<><code className="batch-url">{env.url}</code><p>{t("邮件：")}{env.smtpStatus==='verified'?t("已实际收信并验证"):t("尚未完成真实收信验证")}{env.emailTest?.at?' · '+date(env.emailTest.at):''}</p><p className="muted">{t("公开配置可用于客户端；权限仍由你的 Auth 与 RLS 决定。")}</p>
      <div className="button-row"><button className="button secondary" onClick={()=>void op.run(()=>navigator.clipboard.writeText(JSON.stringify({SUPABASE_URL:env.url,SUPABASE_ANON_KEY:env.key},null,2)),t("已复制公开客户端配置"))} disabled={project?.role==='viewer'}>{t("复制公开配置")}</button><External href={env.settingsUrl}>{t("配置 SMTP")}</External></div>
      <div className="batch-form"><button className="button secondary" disabled={project?.role==='viewer'||(op.busy||!consent||!getSession().user?.email)} onClick={()=>void op.run(async()=>{await api('/projects/'+project.id+'/email-test/'+env.environment,{email:getSession().user.email,confirm:true});await load();},t("请求已接受；请到邮箱查看验证码"))}>{t("发送测试验证码")}</button><label>{t("邮件中的验证码")}<input aria-label={env.environment+t(" 验证码")} inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={tokens[env.environment]||''} onChange={e=>setTokens({...tokens,[env.environment]:e.target.value})}/></label><button className="button secondary" disabled={project?.role==='viewer'||(op.busy||!/^\d{6,10}$/.test(tokens[env.environment]||''))} onClick={()=>void op.run(async()=>{await api('/projects/'+project.id+'/email-verify/'+env.environment,{token:tokens[env.environment]});setTokens({...tokens,[env.environment]:''});await load();},t("真实收信与验证码核验通过"))}>{t("验证送达")}</button></div>
      <button className="text-button" disabled={project?.role==='viewer'||(op.busy)} onClick={()=>void op.run(async()=>{const r=await api('/projects/'+project.id+'/sample',{version:2,environment:env.environment});await onChanged();window.location.hash='/'+project.id+'/deployments/'+r.id;},t("已生成使用此环境配置的新示例"))}>{t("用此环境生成新示例版本 →")}</button></>}
    </article>)}</div>
    <label className="batch-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>{t("允许向当前登录邮箱")}{getSession().user?.email||t("（云端登录后可用）")} {t("发送测试邮件，并在所选数据库中创建测试登录账号。不会发送给其他人。")}</label>
    <details><summary>{t("SMTP 怎样配置？")}</summary><ol><li>{t("在自己的 Supabase 控制台启用 Custom SMTP，填写供应商主机、端口、账号与密码，并完成发信域名验证。")}</li><li>{t("在 Magic Link 邮件模板中显示")}<code>{'{{ .Token }}'}</code> {t("验证码。本测试只接受验证码，不读取邮箱内容。")}</li><li>{t("保存后点击“发送测试验证码”，收到后在这里验证。默认 SMTP 有收件人和频率限制，API 可达不能代表送达。")}</li></ol><p>{t("TapeNow 不读取或保存客户 SMTP 密码。邮件配额与费用属于你自己的供应商。")}</p></details><Feedback op={op}/>
  </section>;
}

export function ArchivesPage({project,onChanged}:{project:Project;onChanged:()=>Promise<unknown>}) {
 useLanguage();
  const op=useOperation(),[report,setReport]=useState<any>(null),[selected,setSelected]=useState<string[]>([]),[days,setDays]=useState(30),[enabled,setEnabled]=useState(false);
  const load=async()=>{const r=await api('/projects/'+project.id+'/retention');setReport(r);setDays(r.policy.days);setEnabled(r.policy.enabled);setSelected([]);};
  useEffect(()=>{void op.run(load,'');},[project.id]);
  const mutate=async(fn:()=>Promise<unknown>)=>{await fn();await load();await onChanged();};
  return <div className="batch-page"><div className="page-heading"><div><h1>{t("归档与保留")}</h1><p>{t("保留关键版本，将过期文件移入七天回收站。")}</p></div><button className="button secondary" disabled={project?.role==='viewer'||(op.busy)} onClick={()=>void op.run(load,t("已刷新"))}>{t("刷新清理预览")}</button></div><section className="panel batch-card"><div className="batch-title"><h2>{t("保留策略")}</h2><Badge>{bytes(report?.retainedBytes||0)}</Badge></div><div className="batch-form"><label>{t("版本保留天数")}<input type="number" min={7} max={365} value={days} onChange={e=>setDays(Number(e.target.value))}/></label><label className="batch-check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>{t("启用到期自动回收（每日检查）")}</label><button className="button secondary" disabled={project?.role==='viewer'||(op.busy)} onClick={()=>void op.run(()=>mutate(()=>api('/projects/'+project.id+'/retention',{days,enabled},'PATCH')))}>{t("保存策略")}</button></div><p>{t("默认不开启自动清理。当前正式版、指定保留点、有效私有预览与未完成的发布受保护。回收七天后，云端任务清除文件并保留清单和历史回执；本地模式不自动清除。")}</p></section>
    <section className="panel"><div className="panel-heading"><h2>{t("清理预览 ·")}{selected.length} {t("个已选")}</h2><button className="button secondary" disabled={project?.role==='viewer'||(op.busy||!selected.length)} onClick={()=>void op.run(()=>mutate(()=>api('/projects/'+project.id+'/trash',{digest:report.digest,releaseIds:selected})),t("已移入七天回收站；现在仍可恢复"))}>{t("移入回收站")}</button></div><div className="batch-list">{report?.releases.map((r:any)=><article className="batch-row" key={r.id}><div className="batch-selection"><input type="checkbox" aria-label={t("选择 ")+r.label} disabled={!r.eligible||op.busy} checked={selected.includes(r.id)} onChange={e=>setSelected(e.target.checked?[...selected,r.id]:selected.filter(id=>id!==r.id))}/><div><strong>{r.label}</strong><p><code>{r.id}</code> · {bytes(r.bytes)} · {r.state==='trash'?t("回收站"):r.state==='purged'?t("文件已清除"):r.state==='purging'?t("正在清除"):t("归档中")}</p><small className="muted">{r.reasons.map(translateMessage).join(' · ')|| (r.purgeAfter?t("计划清除：")+date(r.purgeAfter):r.overdue?t("已超过保留天数"):t("可以手动回收"))}{r.publicCopies?t(" · 外部公开副本不随之删除"):''}</small>{r.error&&<p role="alert">{translateMessage(r.error)}</p>}</div></div><div className="button-row">{r.state==='available'&&<button className="button secondary" disabled={project?.role==='viewer'||(op.busy)} onClick={()=>void op.run(()=>mutate(()=>api('/releases/'+r.id+'/archive-pin',{pinned:!r.pinned},'PATCH')))}>{r.pinned?t("取消保留点"):t("设为保留点")}</button>}{r.state==='trash'&&<button className="button secondary" disabled={project?.role==='viewer'||(op.busy||Date.parse(r.purgeAfter)<=Date.now())} onClick={()=>void op.run(()=>mutate(()=>api('/releases/'+r.id+'/archive-restore',{})),t("归档已恢复"))}>{t("从回收站恢复")}</button>}</div></article>)}</div></section><Feedback op={op}/><Notice>{translateMessage(report?.scope)}{t("。回收只影响 TapeNow 中保留的文件，不会把业务数据库回滚到过去。")}</Notice></div>;
}

export function DiagnosticsPage({project}:{project:Project}) {
 useLanguage();
  const op=useOperation(),[report,setReport]=useState<any>(null);const load=async()=>setReport(await api('/projects/'+project.id+'/diagnostics'));
  useEffect(()=>{void op.run(load,'');},[project.id]);const chain=report?.chain;
  return <div className="batch-page"><div className="page-heading"><div><h1>{t("用量与诊断")}</h1><p>{t("查看项目访问、归档占用与链上文件核验。")}</p></div><button className="button secondary" disabled={project?.role==='viewer'||(op.busy)} onClick={()=>void op.run(load,t("已刷新"))}>{t("刷新数据")}</button></div>
    <div className="stats-grid">{[{label:t("30 天入口请求"),value:report?.traffic.requests??'—'},{label:'HTTP 4xx / 5xx',value:report?.traffic.errors??'—'},{label:t("文件响应字节"),value:report?bytes(report.traffic.bytes):'—'},{label:t("本项目归档"),value:report?bytes(report.archive.bytes):'—'}].map(s=><section className="panel stat-card" key={s.label}><span>{s.label}</span><strong>{s.value}</strong></section>)}</div>
    <Notice>{translateMessage(report?.traffic.scope)}{t("。统计不保存访客 IP、查询参数或页面内容。文件字节不含响应头、错误页和供应商传输费用。")}</Notice>
    <section className="panel batch-card"><h2>{t("归档额度")}</h2><p>{report?.archive.versions||0} {t("个可用 / 回收站版本 · 账户总占用")}{bytes(report?.archive.accountBytes||0)} / {bytes(report?.archive.accountLimit||250*1024*1024)}{t("。清除后的文件不再计入额度。")}</p><a className="text-button" href={'#/'+project.id+'/archives'}>{t("管理归档与保留点 →")}</a></section>
    <section className="panel batch-card"><div className="batch-title"><h2>{t("链上文件核验")}</h2><button className="button primary" disabled={project?.role==='viewer'||(op.busy||!project.chain.cpuIndex||!project.chain.tokenId)} onClick={()=>void op.run(async()=>{await api('/projects/'+project.id+'/chain-observe',{});await load();},t("检查已完成，请查看结果"))}>{op.busy?t("检查中…"):t("核验链上文件")}</button></div><p>{t("处理器")} {project.chain.cpuIndex||t("未设置")} {t("· 芯片")} {project.chain.tokenId||t("未设置")}{t("。从两个 RPC 读取同一历史区块，逐文件检查 SHA-256。不会签名或支付 gas。")}</p>
    {!project.chain.cpuIndex&&<a className="text-button" href={'#/'+project.id+'/settings/chain'}>{t("先设置芯片编号 →")}</a>}
    {chain&&<div className="batch-subcard"><Badge tone={chain.status==='verified'?'teal':'amber'}>{{verified:t("双 RPC 文件核验通过"),different:t("链上内容与归档不同"),unavailable:t("RPC 不可用"),unverified:t("未获得完整核验")}[chain.status as string]||chain.status}</Badge><p>{translateMessage(chain.error||t("{0} 个文件 · {1} · 区块 {2}", [chain.files?.length||0,bytes(chain.bytes||0),chain.blockNumber]))}</p><p>{t("检查时间：")}{date(chain.checkedAt)}</p>{chain.paidUntil&&<p>{t("容器域名：")}{chain.live?t("有效"):t("未生效或已到期")} {t("· 有效期至")}{date(chain.paidUntil)}</p>}{chain.expectedMatch===null&&<p>{t("尚无本项目已发布归档可供对比；本次验证链上目录与声明哈希。")}</p>}{chain.changes&&<p>{t("相对上次：新增")}{chain.changes.added.length} {t("· 修改")}{chain.changes.modified.length} {t("· 删除")}{chain.changes.removed.length}</p>}<p className="muted">{translateMessage(chain.scope)}</p>{chain.nativeUrl&&<External href={chain.nativeUrl}>{t("打开原生入口")}</External>}</div>}
    <p className="muted">{t("按项目所选 BSC 或 X Layer 网络核验链上文件；第三方网关状态不能替代文件哈希读回结果。")}</p></section>
    <section className="panel batch-card"><h2>{t("项目检查项")}</h2>{report?.checks.map((c:any)=><div className="batch-row" key={c.name}><strong>{translateMessage(c.name)}</strong><span>{translateMessage(c.detail)}</span></div>)}</section><Feedback op={op}/>
  </div>;
}
