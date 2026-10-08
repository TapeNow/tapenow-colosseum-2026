import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual, createHash } from 'node:crypto';
import {demand} from '../server/core.mjs';
export const nonce = () => randomBytes(32).toString('base64url');
export const fingerprint = s => createHash('sha256').update(s).digest('hex');
export function seal(value, key, purpose) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'base64'),iv);
  cipher.setAAD(Buffer.from(purpose));
  const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url');
}
export function unseal(box,key,purpose) {
  const b=Buffer.from(box,'base64url');
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'base64'),b.subarray(0,12));
  decipher.setAAD(Buffer.from(purpose));decipher.setAuthTag(b.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString());
}
export function equal(a,b) {
  return typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
export function assertOrigin(request,origin) {
  demand(request.headers.get('origin')===origin,'请从 TapeNow 官方页面执行此操作',403);
  demand(!request.headers.get('sec-fetch-site') || ['same-origin','none'].includes(request.headers.get('sec-fetch-site')),'不允许跨站操作',403);
}
export const cookieName='__Host-tapenow';
export function sessionCookie(sid,ttl=604800) {return `${cookieName}=${sid}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${ttl}`;}
export function readSession(request) {
  const raw=request.headers.get('cookie')||'';
  const match=raw.match(/(?:^|;\s*)__Host-tapenow=([\w-]{43})(?:;|$)/);
  return match?.[1]||null;
}
export function safeError(error) {
  const status=Number(error.status)||500;
  return Response.json({error:status>=500?'服务暂时未完成此操作，请稍后重试':error.message,...(error.code==='operation_in_progress'?{code:error.code,operationId:error.operationId}:{}),...(/^turnstile_/.test(error.code||'')?{code:error.code}:{})},{status,headers:{'Cache-Control':'no-store'}});
}
export async function readLimitedText(request, limit=8192) {
  demand(Number(request.headers.get('content-length') || 0)<=limit,'请求内容过大',413);
  const reader=request.body?.getReader();
  demand(reader,'请提供请求内容',400);
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();demand(false,'请求内容过大',413);}chunks.push(value);}
  return Buffer.concat(chunks).toString('utf8');
}
export async function readLimitedJson(request, limit=8192) {
  const text=await readLimitedText(request,limit);
  let value;try{value=JSON.parse(text);}catch{demand(false,'JSON 格式无效',400);}
  demand(value&&typeof value==='object'&&!Array.isArray(value),'请提供 JSON 对象',400);
  return value;
}
export async function authFetch(env,path,body,accessToken) {
  const response=await fetch(env.SUPABASE_URL+'/auth/v1'+path,{
    method:body===undefined?'GET':'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
    headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json',...(accessToken?{Authorization:'Bearer '+accessToken}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const data=await response.json().catch(()=>({}));
  demand(response.ok, response.status===429?'请求较频繁，请稍后再试':'登录未完成，请检查凭据或验证码', response.status===429?429:401);
  return data;
}
// WebMCP only exists in origin-isolated documents and, outside Chrome's testing flag, only
// when the document carries an origin-trial token issued for its exact origin.
export function documentHeaders(headers,env) {
  if(!/^text\/html\b/i.test(headers.get('content-type')||''))return headers;
  headers.set('Origin-Agent-Cluster','?1');
  const tokens=String(env.WEBMCP_ORIGIN_TRIAL||'').split(/[\s,]+/).filter(Boolean),valid=tokens.filter(t=>/^[A-Za-z0-9+/]+={0,2}$/.test(t));
  if(valid.length<tokens.length)console.error('WEBMCP_ORIGIN_TRIAL contains an invalid token; it was not sent');
  if(valid.length)headers.set('Origin-Trial',valid.join(', '));
  return headers;
}
