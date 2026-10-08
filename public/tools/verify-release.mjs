#!/usr/bin/env node
// Offline verifier for TapeNow release archives. Uses only built-in Node.js modules
// and makes no network requests. Keep receipt-keys.mjs in the same directory.
//   node verify-release.mjs release.json keys.json <pinned-fingerprint> <site-dir>
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyTrustedReceipt} from './receipt-keys.mjs';

// receipt-keys.mjs reports in Chinese (the workbench translates it); the CLI prints both.
const EN={
  '需要 Ed25519 公钥':'Ed25519 public key required',
  '公钥历史格式无效':'Invalid public-key history format',
  '公钥状态无效':'Invalid public-key status',
  '公钥注册表存在重复 keyId':'Duplicate keyId in public-key registry',
  '需要独立确认的 SHA-256 公钥指纹':'An independently confirmed SHA-256 public-key fingerprint is required',
  '可信公钥不在注册表中或内容不符':'Trusted public key is missing from the registry or does not match',
  '此公钥已撤销':'This public key has been revoked',
  '未知公钥状态':'Unknown public-key status',
  '回执公钥不匹配':'Receipt public-key mismatch',
  '签名 keyId 不匹配':'Signature keyId mismatch',
  '回执签名无效':'Invalid receipt signature',
};
const USAGE='用法 / Usage: node verify-release.mjs release.json keys.json <独立核对的 SHA-256 公钥指纹 / pinned SHA-256 key fingerprint> <site 目录 / site directory>';
const fail=(zh,en)=>{throw Object.assign(new Error(zh),{en});};

const args=process.argv.slice(2);
if(args.includes('-h')||args.includes('--help')){console.log(USAGE);process.exit(0);}
const [receiptFile,registryFile,fingerprint,siteDir]=args;
try {
  if(!siteDir)fail(USAGE);
  const receipt=JSON.parse(fs.readFileSync(receiptFile)),registry=JSON.parse(fs.readFileSync(registryFile));
  const result=verifyTrustedReceipt(receipt,registry,fingerprint);
  const root=fs.realpathSync(siteDir);
  if(!Array.isArray(receipt.payload.files)||!receipt.payload.files.length)fail('回执缺少文件清单','The receipt has no file manifest');
  if(createHash('sha256').update(JSON.stringify(receipt.payload.files)).digest('hex')!==receipt.payload.manifestHash)fail('清单摘要不一致','Manifest hash does not match the file list');
  const seen=new Set();
  for(const f of receipt.payload.files){
    if(typeof f.path!=='string'||seen.has(f.path)||path.isAbsolute(f.path))fail('清单路径无效或重复','Invalid or duplicate path in the manifest');seen.add(f.path);
    const filename=fs.realpathSync(path.resolve(root,f.path));
    if(!filename.startsWith(root+path.sep))fail('文件越界','File resolves outside the site directory');
    const bytes=fs.readFileSync(filename);
    if(bytes.length!==f.bytes||createHash('sha256').update(bytes).digest('hex')!==f.sha256)fail('文件不匹配: '+f.path,'File does not match: '+f.path);
  }
  console.log(JSON.stringify({...result,files:receipt.payload.files.length,
    note:'证明归档与该公钥签署内容一致；不证明网站当前在线或数据库未改变。',
    noteEn:'Proves the archive matches what this key signed. It does not prove the website is online now or that any database is unchanged.'},null,2));
}catch(error){
  const en=error.en??EN[error.message];
  console.error(error.message+(en&&en!==error.message?'\n'+en:''));
  process.exitCode=1;
}
