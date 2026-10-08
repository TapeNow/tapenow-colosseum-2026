import React,{createContext,useContext,useSyncExternalStore} from 'react';
import english from './locales/en.json';
export type Language='zh-CN'|'en';
const storageKey='tapenow.language';
let language:Language='en';
try{if(globalThis.localStorage?.getItem(storageKey)==='zh-CN')language='zh-CN';}catch{}
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const snapshot=()=>language;
export function setLanguage(next:Language){language=next==='zh-CN'?'zh-CN':'en';try{globalThis.localStorage?.setItem(storageKey,language);}catch{}if(typeof document!=='undefined')document.documentElement.lang=language;listeners.forEach(listener=>listener());}
if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(event.key===storageKey){language=event.newValue==='zh-CN'?'zh-CN':'en';document.documentElement.lang=language;listeners.forEach(listener=>listener());}});
const normalize=(text:string)=>text.replace(/\s+/g,' ').trim();
const catalog:Record<string,string>=english;
if(typeof document!=='undefined')document.documentElement.lang=language;
export function t(source:string,params:Record<string,string|number>|Array<string|number>={}):string {
  const found=language==='en'?catalog[normalize(source)]:undefined;
  const translated=found?((source.match(/^\s+/)?.[0]||'')+found+(source.match(/\s+$/)?.[0]||'')):source;
  return translated.replace(/\{(\w+)\}/g,(match,key:string)=>Object.prototype.hasOwnProperty.call(params,key)?String((params as Record<string,string|number>)[key]):match);
}
const LanguageContext=createContext<Language>('en');
export function LanguageProvider({children}:{children:React.ReactNode}){const current=useSyncExternalStore(subscribe,snapshot,()=> 'en' as Language);return <LanguageContext.Provider value={current}>{children}</LanguageContext.Provider>;}
export function useLanguage(){useContext(LanguageContext);const current=useSyncExternalStore(subscribe,snapshot,()=> 'en' as Language);return {language:current,setLanguage,t};}
export const useT=()=>useLanguage().t;
export function LanguageSwitcher(){const {language}=useLanguage();return <label className="language-switcher"><span>{language==='en'?'Language':'语言'}</span><select aria-label={language==='en'?'Interface language':'界面语言'} value={language} onChange={event=>setLanguage(event.target.value as Language)}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>;}
export function Tr({source,params}:{source:string;params?:Record<string,string|number>|Array<string|number>}){useLanguage();return <>{t(source,params)}</>;}
export function localeDate(value:string|number|Date,options:Intl.DateTimeFormatOptions={}){const date=value instanceof Date?value:new Date(value);return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat(language==='en'?'en-US':'zh-CN',options).format(date);}
// Only complete known message templates are matched; captured user data stays untouched.
const reverse=Object.fromEntries(Object.entries(catalog).map(([source,target])=>[target,source]));
const escapePattern=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.entries(catalog).filter(([source])=>/\{\d+\}/.test(source)&&source.replace(/\{\d+\}/g,'').length>=4).map(([source,target])=>({source,target,sourceRegex:new RegExp('^'+escapePattern(source).replace(/\\\{\d+\\\}/g,'([\\s\\S]*?)')+'$'),targetRegex:new RegExp('^'+escapePattern(target).replace(/\\\{\d+\\\}/g,'([\\s\\S]*?)')+'$')}));
export function translateMessage(value:unknown):string {
 const source=String(value??''),key=normalize(source);
 if(language==='en'&&catalog[key])return t(source);
 if(language==='zh-CN'&&reverse[key])return reverse[key];
 if(source.length>8192)return source;
 for(const pattern of patterns){const match=(language==='en'?pattern.sourceRegex:pattern.targetRegex).exec(key);if(match)return (language==='en'?pattern.target:pattern.source).replace(/\{(\d+)\}/g,(_,index)=>match[Number(index)+1]??'');}
 return source;
}
// For immutable, source-authored UI catalogs only. Never wrap API records or user input.
const modelCache=new WeakMap<object,object>();
export function uiModel<T extends object>(model:T):T {
 const known=modelCache.get(model);if(known)return known as T;
 const proxy=new Proxy(model,{get(target,key,receiver){const value=Reflect.get(target,key,receiver);if(typeof value==='string')return t(value);if(value&&typeof value==='object'&&(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype))return uiModel(value);return value;}});
 modelCache.set(model,proxy);return proxy;
}
const statusSources:Record<string,string>={reachable:'可访问',unreachable:'无法访问',blocked:'访问受限',verified:'已核验',connected:'已连接',unavailable:'暂不可用',available:'可用',unknown:'未知',pending:'待处理',ready:'预览就绪',active:'有效',inactive:'未生效或已到期',failed:'失败',complete:'已完成',completed:'已完成',viewer:'只读成员 · Viewer',publisher:'发布者 · Publisher',owner:'所有者',preview:'预览',production:'生产',script:'脚本',font:'字体',image:'图片',api:'业务 API',healthy:'正常',ok:'正常',degraded:'服务降级',error:'错误',offline:'离线',online:'在线',current:'当前',retired:'历史',revoked:'已撤销'};
export function statusLabel(value:string){return statusSources[value]?t(statusSources[value]):translateMessage(value);}
