import { t, useLanguage, LanguageSwitcher, translateMessage } from "./i18n";
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {api,initialize,getSession} from './api';
import {Brand} from './ui';
import {ArrowRight,LogOut,ShieldCheck,Wallet} from 'lucide-react';
import './auth.css';
export function AccountMenu(){
 useLanguage();
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false),[linked,setLinked]=useState<string|null>(null);
  const s=getSession(),wallets=useWallets(!!s.user?.email);
  useEffect(()=>{if(s.mode==='cloud'&&s.user?.email)void api<{wallet?:{address:string}}>('/account/wallet').then(r=>setLinked(r.wallet?.address||null)).catch(()=>{});},[s.mode,s.user?.id]);
  if(s.mode!=='cloud')return null;
  const who=s.user?.email||s.user?.wallet||'',label=s.user?.email||(s.user?.wallet?s.user.wallet.slice(0,6)+'…'+s.user.wallet.slice(-4):'');
  const bind=(w:Eip1193)=>async()=>{setBusy(true);setError('');try{
    const [address]=await w.request({method:'eth_requestAccounts'});if(!address)throw Error(t('钱包未连接'));
    const current=parseInt(String(await w.request({method:'eth_chainId'}).catch(()=>'0x38')),16);
    const issued=await api<{message:string;challenge:string}>('/account/wallet/challenge',{address,chainId:WALLET_CHAINS.includes(current)?current:56});
    const hex='0x'+Array.from(new TextEncoder().encode(issued.message)).map(b=>b.toString(16).padStart(2,'0')).join('');
    const signature=await w.request({method:'personal_sign',params:[hex,address]});
    const result=await api<{address:string}>('/account/wallet/link',{challenge:issued.challenge,message:issued.message,signature});setLinked(result.address);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="account-menu"><span title={who}>{label}</span>{s.user?.email&&<><button className="icon-button" title={t("账号钱包绑定")} aria-label={t("账号钱包绑定")} onClick={()=>setOpen(!open)}><Wallet size={16}/></button>{open&&<div className="account-wallet-popover" role="dialog" aria-label={t("账号钱包绑定")}><strong>{t("账号钱包绑定")}</strong>{linked?<p>{t("已绑定钱包")}<code>{linked}</code></p>:<><p>{t("绑定后可用钱包签名登录此邮箱账号；签名不发送交易，也不花 gas。已有独立项目的钱包暂不能绑定。")}</p>{wallets.length?wallets.map(w=><button key={w.id} className="button secondary" disabled={busy} onClick={bind(w.provider)}>{t("绑定 {0}",[w.name])}</button>):<p>{t("未检测到钱包，请在浏览器安装钱包扩展或使用钱包 App。")}</p>}</>}{error&&<p role="alert">{translateMessage(error)}</p>}<button className="text-button" onClick={()=>setOpen(false)}>{t("关闭")}</button></div>}</>}<button className="icon-button" title={t("退出登录")} aria-label={t("退出登录")} disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await api('/auth/logout',{});window.dispatchEvent(new Event('tapenow-signed-out'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><LogOut size={16}/></button>{error&&!open&&<span role="alert">{translateMessage(error)}</span>}</div>;
}
const WALLET_CHAINS=[56,196,8453];
type Eip1193={request:(args:{method:string;params?:unknown[]})=>Promise<any>};
type WalletOption={id:string;name:string;rdns?:string;icon?:string;provider:Eip1193};
// Wallets tied to TapeOut's chains, in chain order: X Layer, BSC, Base, then the
// general-purpose default. Installed ones are listed first; missing ones get an
// official download link so phone and new users know where to start.
const RECOMMENDED=[
  {name:'OKX Wallet',match:/okx|okex/i,href:'https://web3.okx.com/download'},
  {name:'Binance Wallet',match:/binance/i,href:'https://www.binance.com/en/web3wallet'},
  {name:'Coinbase Wallet',match:/coinbase/i,href:'https://www.coinbase.com/wallet/downloads'},
  {name:'MetaMask',match:/metamask/i,href:'https://metamask.io/download/'}];
const rank=(w:WalletOption)=>{const i=RECOMMENDED.findIndex(r=>r.match.test(w.rdns||'')||r.match.test(w.name));return i<0?RECOMMENDED.length:i;};
// EIP-6963 lets every installed wallet announce itself, so a browser with both OKX
// and MetaMask offers a choice instead of whichever injected window.ethereum last.
// Wallet apps' built-in browsers that only inject a global fall back to it.
function useWallets(enabled:boolean){
  const [wallets,setWallets]=useState<WalletOption[]>([]);
  useEffect(()=>{
    if(!enabled)return;
    const seen=new Map<string,WalletOption>();
    const announce=(e:Event)=>{const d=(e as CustomEvent).detail;if(!d?.info?.uuid||typeof d.provider?.request!=='function')return;
      const icon=typeof d.info.icon==='string'&&/^data:image\/(png|svg\+xml|webp|jpeg);/.test(d.info.icon)?d.info.icon:undefined;
      seen.set(d.info.rdns||d.info.uuid,{id:d.info.uuid,name:String(d.info.name||'Wallet').slice(0,40),rdns:typeof d.info.rdns==='string'?d.info.rdns:undefined,icon,provider:d.provider});setWallets([...seen.values()].sort((a,b)=>rank(a)-rank(b)));};
    window.addEventListener('eip6963:announceProvider',announce);window.dispatchEvent(new Event('eip6963:requestProvider'));
    const fallback=setTimeout(()=>{const w=window.okxwallet||window.ethereum;if(!seen.size&&w)setWallets([{id:'injected',name:t('浏览器钱包'),provider:w}]);},400);
    return()=>{window.removeEventListener('eip6963:announceProvider',announce);clearTimeout(fallback);};
  },[enabled]);
  return wallets;
}
// The Worker writes the EIP-4361 message; the browser only chooses the account and
// reports its current network. Unsupported networks sign as BSC: the Chain ID is
// context, and one address is one TapeNow account on all three chains.
// Turnstile loads only when the Worker asks for it (a new email or wallet would
// claim a beta seat); returning accounts never download the script.
type Guard=<T>(action:string,call:(token?:string)=>Promise<T>)=>Promise<T>;
type Challenge={action:string;resolve:(token:string)=>void;reject:(error:Error)=>void};
declare global{interface Window{turnstile?:{render:(el:HTMLElement,options:Record<string,unknown>)=>string;remove:(id:string)=>void}}}
let turnstileScript:Promise<void>|null=null;
function loadTurnstile(){
  return turnstileScript||=new Promise<void>((resolve,reject)=>{const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
    script.onload=()=>resolve();script.onerror=()=>{turnstileScript=null;reject(Error(t('人机验证加载失败，请检查网络后重试')));};document.head.appendChild(script);});
}
function HumanCheck({siteKey,challenge}:{siteKey:string;challenge:Challenge}){
  const {language}=useLanguage(),box=useRef<HTMLDivElement>(null);
  useEffect(()=>{let id='',live=true;
    loadTurnstile().then(()=>{if(!live||!box.current||!window.turnstile)return;id=window.turnstile.render(box.current,{sitekey:siteKey,action:challenge.action,language:language==='en'?'en':'zh-cn',
      callback:(token:string)=>challenge.resolve(token),'error-callback':()=>challenge.reject(Error(t('人机验证未通过，请重试'))),'expired-callback':()=>challenge.reject(Error(t('人机验证已过期，请重试')))});})
      .catch(error=>challenge.reject(error));
    return()=>{live=false;if(id)window.turnstile?.remove(id);};},[siteKey,challenge,language]);
  return <div className="auth-human" role="group" aria-label={t('人机验证')}><p>{t('首次注册需要完成一次人机验证，通常会自动通过。')}</p><div ref={box}/></div>;
}
async function signInWithWallet(w:Eip1193|undefined,guard:Guard){
  if(!w)throw Error(t('没有检测到钱包。请在电脑浏览器安装钱包扩展，或在钱包 App 的内置浏览器中打开 TapeNow。'));
  const [address]=await w.request({method:'eth_requestAccounts'});if(!address)throw Error(t('钱包未连接'));
  const current=parseInt(String(await w.request({method:'eth_chainId'}).catch(()=>'0x38')),16);
  const issued=await guard('wallet-signup',token=>api<{message:string;challenge:string}>('/auth/wallet/challenge',{address,chainId:WALLET_CHAINS.includes(current)?current:56,...(token?{turnstileToken:token}:{})}));
  const hex='0x'+Array.from(new TextEncoder().encode(issued.message)).map(b=>b.toString(16).padStart(2,'0')).join('');
  const signature=await w.request({method:'personal_sign',params:[hex,address]});
  await api('/auth/wallet/verify',{challenge:issued.challenge,message:issued.message,signature});
}
export function SessionBoundary({children}:{children:ReactNode}){
 useLanguage();
  const [ready,setReady]=useState(false),[allowed,setAllowed]=useState(false),[error,setError]=useState('');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState('');
  const [mode,setMode]=useState<'email'|'password'>('email'),[sent,setSent]=useState(false),[busy,setBusy]=useState(false);
  const [signup,setSignup]=useState<{mode:'invite'|'open';wallet:boolean;turnstile?:string}>({mode:'invite',wallet:false});
  const [challenge,setChallenge]=useState<Challenge|null>(null);
  const wallets=useWallets(signup.wallet);
  // Retry once with a Turnstile token when the Worker answers turnstile_required.
  const guard:Guard=async(action,call)=>{
    try{return await call();}catch(e){
      if((e as {code?:string}).code!=='turnstile_required'||!signup.turnstile)throw e;
      try{const token=await new Promise<string>((resolve,reject)=>setChallenge({action,resolve,reject}));return await call(token);}
      finally{setChallenge(null);}
    }
  };
  const walletLogin=(w?:Eip1193)=>async()=>{setBusy(true);setError('');try{await signInWithWallet(w,guard);await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  async function load(){try{const s=await initialize();setAllowed(s.mode!=='cloud'||s.authenticated);if(s.signup)setSignup(s.signup);setReady(true);}catch(e){setError((e as Error).message);setReady(true);}}
  useEffect(()=>{void load();const signedOut=()=>{setAllowed(false);setPassword('');setCode('');setSent(false);window.location.hash='/';for(const k of Object.keys(localStorage))if(k.startsWith('deweb-pending-'))localStorage.removeItem(k);};window.addEventListener('tapenow-signed-out',signedOut);return()=>window.removeEventListener('tapenow-signed-out',signedOut);},[]);
  if(!ready)return <main className="auth-page"><LanguageSwitcher/><p>{t("正在连接 TapeNow…")}</p></main>;
  if(allowed)return <>{children}</>;
  return <main className="auth-page"><div className="auth-shell"><aside className="auth-story"><Brand tone="dark"/><div className="auth-story-copy"><h2><span>{t("好作品，")}</span><span>{t("接着发布。")}</span></h2><p>{t("连接代码、构建与发布。用你已有的云服务，管理每一个版本。")}</p></div><img className="auth-story-mark" src="/brand/v2/mark-dark.svg" width="192" height="192" alt="" aria-hidden="true"/><span className="auth-story-caption" aria-hidden="true">CREATE · PREVIEW · PUBLISH</span></aside><div className="auth-card"><LanguageSwitcher/><Brand/><div className="auth-eyebrow">{signup.mode==='open'?'TAPENOW · PUBLIC BETA':'TAPENOW · INVITATION BETA'}</div><h1>{t("让作品，走向链上。")}</h1><p>{t("连接代码、构建与发布。用你已有的云服务，管理每一个版本。")}</p>
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{
      if(mode==='password'){await api('/auth/password',{email,password});await load();}
      else if(sent){await api('/auth/verify',{email,token:code});await load();}
      else {await guard('email-signup',token=>api('/auth/otp',{email,...(token?{turnstileToken:token}:{})}));setSent(true);}
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
      <label>{signup.mode==='open'?t("邮箱"):t("受邀邮箱")}<input type="email" autoComplete="email" required value={email} disabled={busy||sent} onChange={e=>setEmail(e.target.value)}/></label>
      {mode==='password'?<label>{t("密码")}<input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={e=>setPassword(e.target.value)}/></label>:sent?<label>{t("邮件验证码")}<input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6,10}" value={code} onChange={e=>setCode(e.target.value)}/></label>:null}
      {challenge&&signup.turnstile&&<HumanCheck siteKey={signup.turnstile} challenge={challenge}/>}
      {error&&<p role="alert" className="auth-error">{translateMessage(error)}</p>}
      {sent&&<p role="status">{t("验证码已发送，请检查收件箱。")}</p>}
      <button className="button primary" disabled={busy}>{busy?t("正在处理…"):mode==='password'||sent?t("登录工作台"):t("发送登录验证码")}<ArrowRight size={16}/></button>
    </form>{signup.wallet&&<><div className="auth-divider"><span>{t("或")}</span></div>{wallets.length>0?<div className="auth-wallets" role="group" aria-label={t("用钱包登录")}>{wallets.map(w=><button key={w.id} className="button secondary auth-wallet" type="button" disabled={busy} onClick={walletLogin(w.provider)}>{w.icon?<img src={w.icon} alt="" width="18" height="18"/>:<Wallet size={16}/>}{t("用 {0} 登录",[w.name])}</button>)}</div>:<button className="button secondary auth-wallet" type="button" disabled={busy} onClick={walletLogin(wallets[0]?.provider)}><Wallet size={16}/>{t("用钱包登录")}</button>}{(()=>{const missing=RECOMMENDED.filter(r=>!wallets.some(w=>r.match.test(w.rdns||'')||r.match.test(w.name)));return missing.length>0&&<p className="auth-wallet-install">{wallets.length?t("安装其他钱包："):t("没有钱包？安装：")}{missing.map((r,i)=><span key={r.name}>{i>0&&' · '}<a href={r.href} target="_blank" rel="noreferrer">{r.name}</a></span>)}</p>;})()}<p className="auth-wallet-hint">{t("支持 BSC、X Layer、Base 的 EVM 钱包。登录只需签名一条消息，不发送交易，不花 gas。")}</p></>}<div className="auth-options"><button onClick={()=>{setMode(mode==='email'?'password':'email');setSent(false);setError('');}}>{mode==='email'?t("使用密码登录"):t("使用邮箱验证码")}</button>{sent?<button onClick={()=>{setSent(false);setCode('');}}>{t("更换邮箱 / 重新发送")}</button>:mode==='email'&&<button onClick={()=>{setSent(true);setError('');}}>{t("已收到邀请验证码？直接输入")}</button>}</div>
    <div className="auth-note"><ShieldCheck size={16}/><span>{signup.mode==='open'?t("当前为公开测试，名额有限。账户授权、项目与发布记录按用户隔离。新文件仅保存为归档，可选择私有或公开预览。"):t("当前为邀请测试。账户授权、项目与发布记录按用户隔离。新文件仅保存为归档，可选择私有或公开预览。")}</span></div><footer><a href="/docs/manual/">{t("用户手册")}</a><a href="/docs/privacy.html">{t("隐私说明")}</a><a href="/docs/terms.html">{t("服务条款")}</a></footer>
  </div></div></main>;
}
