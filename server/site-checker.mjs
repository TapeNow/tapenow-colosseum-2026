import {createHash} from 'node:crypto';
import {safePath} from './core.mjs';
const fail=()=>{throw Object.assign(Error('站点检查未通过'),{status:409});};
export function normalizeSiteHostname(name){if(typeof name!=='string'||name.length>253||name!==name.toLowerCase()||! /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name)||/\.(localhost|local|internal|test|invalid|example)$/.test(name))fail();return name;}
export function normalizeSiteFiles(files){
 if(!Array.isArray(files)||files.length<1||files.length>500)fail();let total=0;const seen=new Set();
 const normalized=files.map(f=>{if(!f||typeof f!=='object'||Array.isArray(f)||Object.keys(f).some(k=>!['path','bytes','sha256'].includes(k)))fail();
 let path;try{path=safePath(f.path);}catch{fail();}
 if(seen.has(path)||!Number.isSafeInteger(f.bytes)||f.bytes<0||typeof f.sha256!=='string'||!/^[a-fA-F0-9]{64}$/.test(f.sha256))fail();
 seen.add(path);total+=f.bytes;if(total>10*1024*1024)fail();return {path,bytes:f.bytes,sha256:f.sha256.toLowerCase()};});
 return normalized.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export const siteManifestHash=files=>createHash('sha256').update(JSON.stringify(normalizeSiteFiles(files))).digest('hex');
export async function verifySiteRemote(config,hostname,files,{fetcher=fetch}={}){
 try{
  normalizeSiteHostname(hostname);const normalized=normalizeSiteFiles(files.map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256}))),digest=siteManifestHash(normalized);
  const base=new URL(config?.url);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/'||(base.port&&base.port!=='443'))fail();normalizeSiteHostname(base.hostname);
  if(typeof config.token!=='string'||config.token.length<16||config.token.length>4096||/[\r\n]/.test(config.token))fail();
  const body=JSON.stringify({hostname,files:normalized});if(Buffer.byteLength(body)>512*1024)fail();
  const response=await fetcher(new URL('/verify-site',base),{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(60000)});if(!response.ok)fail();
  const reader=response.body?.getReader();if(!reader)fail();let size=0;const parts=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192)fail();parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  const r=JSON.parse(Buffer.concat(parts).toString()),bytes=normalized.reduce((n,f)=>n+f.bytes,0);
  if(r.status!=='verified'||r.verified!==true||r.hostname!==hostname||r.manifestHash!==digest||r.files!==normalized.length||r.bytes!==bytes||r.scope!=='private-node-checker'||typeof r.checkedAt!=='string'||!Number.isFinite(Date.parse(r.checkedAt)))fail();
  return {status:'verified',verified:true,hostname,manifestHash:digest,files:normalized.length,bytes,checkedAt:r.checkedAt,scope:'private-node-checker'};
 }catch{fail();}
}
