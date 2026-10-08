import {createPublicKey,createHash,verify} from 'node:crypto';
export function keyFingerprint(pem) {
  const key=createPublicKey(pem);if(key.asymmetricKeyType!=='ed25519')throw new Error('需要 Ed25519 公钥');
  return createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
}
export function keyRegistry(publicKey,history=[]) {
  if(typeof history==='string')history=JSON.parse(history);
  if(!Array.isArray(history))throw new Error('公钥历史格式无效');
  const currentFingerprint=keyFingerprint(publicKey);
  const keys=[{publicKey,status:'current'},...history].map(k=>{
    if(!['current','retired','revoked'].includes(k.status))throw new Error('公钥状态无效');
    const fingerprint=keyFingerprint(k.publicKey);
    return {keyId:'ed25519:'+fingerprint,fingerprint,algorithm:'Ed25519',publicKey:k.publicKey,status:k.status,
      ...(k.validFrom?{validFrom:k.validFrom}:{}),...(k.retiredAt?{retiredAt:k.retiredAt}:{}),...(k.reason?{reason:k.reason}:{})};
  });
  if(new Set(keys.map(k=>k.keyId)).size!==keys.length)throw new Error('公钥注册表存在重复 keyId');
  return {schema:'tapenow-keys/v1',currentKeyId:'ed25519:'+currentFingerprint,keys,
    trust:'请通过独立渠道核对并固定公钥指纹。注册表本身不是外部信任证明。'};
}
export function verifyTrustedReceipt(receipt,registry,pinnedFingerprint) {
  if(!/^[a-f0-9]{64}$/.test(pinnedFingerprint||''))throw new Error('需要独立确认的 SHA-256 公钥指纹');
  const trusted=registry.keys.find(k=>k.fingerprint===pinnedFingerprint);
  if(!trusted||keyFingerprint(trusted.publicKey)!==pinnedFingerprint)throw new Error('可信公钥不在注册表中或内容不符');
  if(trusted.status==='revoked')throw new Error('此公钥已撤销');
  if(!['current','retired'].includes(trusted.status))throw new Error('未知公钥状态');
  if(receipt.algorithm!=='Ed25519'||keyFingerprint(receipt.publicKey)!==pinnedFingerprint)throw new Error('回执公钥不匹配');
  if(receipt.payload.keyId&&receipt.payload.keyId!==trusted.keyId)throw new Error('签名 keyId 不匹配');
  if(!verify(null,Buffer.from(JSON.stringify(receipt.payload)),trusted.publicKey,Buffer.from(receipt.signature,'base64')))throw new Error('回执签名无效');
  return {verified:true,keyId:trusted.keyId,legacy:!receipt.payload.keyId,status:trusted.status};
}
