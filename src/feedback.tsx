import {useEffect,useState} from 'react';
import {MessageSquarePlus} from 'lucide-react';
import {api,getSession} from './api';
import {Modal} from './ui';
import {t,useLanguage,translateMessage} from './i18n';

// Sent with every report so phone issues can be reproduced without asking the
// user for details. Only location, screen and the last visible error: no page content.
function context(){
  const alert=Array.from(document.querySelectorAll('[role="alert"]')).map(el=>el.textContent?.trim()).filter(Boolean).at(-1);
  return {page:location.hash.slice(0,200)||'/',language:document.documentElement.lang||navigator.language,viewport:{width:innerWidth,height:innerHeight},touch:navigator.maxTouchPoints>0,lastError:alert||undefined};
}
export function FeedbackButton(){
  const {language}=useLanguage();
  const [open,setOpen]=useState(false),[category,setCategory]=useState('bug'),[message,setMessage]=useState('');
  const [captured,setCaptured]=useState<ReturnType<typeof context>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(false);
  // tapenow.dev links here with ?feedback=1; open the form once the workspace is ready.
  useEffect(()=>{const url=new URL(location.href);if(url.searchParams.get('feedback')!=='1')return;url.searchParams.delete('feedback');history.replaceState(null,'',url.pathname+url.search+url.hash);setCaptured(context());setOpen(true);},[]);
  if(getSession().mode!=='cloud')return null;
  const close=()=>{setOpen(false);setSent(false);setError('');};
  return <>
    <button className="topbar-help topbar-feedback" aria-label={t('发送反馈')} title={t('发送反馈')} onClick={()=>{setCaptured(context());setOpen(true);}}><MessageSquarePlus size={16}/></button>
    {open&&<Modal title={t('发送反馈')} onClose={close} busy={busy}>
      {sent?<div className="modal-form"><p role="status">{t('已收到，谢谢！我们会逐条查看。')}</p><div className="modal-actions"><button className="button primary" onClick={close}>{t('关闭')}</button></div></div>:
      <form className="modal-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await api('/feedback',{category,message,context:{...captured,language}});setMessage('');setSent(true);}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}>
        <fieldset className="feedback-kinds"><legend>{t('类型')}</legend>{[['bug',t('遇到问题')],['idea',t('功能建议')],['other',t('其他')]].map(([value,label])=><label key={value} className="checkbox-label"><input type="radio" name="feedback-kind" value={value} checked={category===value} onChange={()=>setCategory(value)}/>{label}</label>)}</fieldset>
        <label>{t('发生了什么？')}<textarea required minLength={5} maxLength={2000} rows={5} value={message} onChange={e=>setMessage(e.target.value)} placeholder={t('例如：在手机上点“发布”后没有反应。')}/></label>
        <p className="muted small-text">{t('会一起发送：当前页面、屏幕尺寸、浏览器和最近的错误提示，方便我们复现。不会发送页面内容、文件、钱包私钥或密码。')}</p>
        {captured?.lastError&&<p className="muted small-text">{t('最近的错误提示：')}{translateMessage(captured.lastError)}</p>}
        {error&&<p role="alert">{translateMessage(error)}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={close} disabled={busy}>{t('取消')}</button><button className="button primary" disabled={busy||message.trim().length<5}>{busy?t('正在发送…'):t('发送反馈')}</button></div>
      </form>}
    </Modal>}
  </>;
}
