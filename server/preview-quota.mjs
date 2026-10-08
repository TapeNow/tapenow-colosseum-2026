import {BETA_LIMITS} from './beta-policy.mjs';
export function reservePreview(usage,input,time=Date.now()) {
  const month=new Date(time).toISOString().slice(0,7),current=usage?.month===month?usage:{month,requests:0,bytes:0};
  if(!Number.isSafeInteger(input.bytes)||input.bytes<0||input.bytes>10*1024*1024)throw Object.assign(Error('Invalid preview reservation'),{status:400});
  if(current.requests>=BETA_LIMITS.previewRequests||current.bytes+input.bytes>BETA_LIMITS.previewBytes)return {allowed:false,usage:current};
  return {allowed:true,usage:{month,requests:current.requests+1,bytes:current.bytes+input.bytes}};
}
