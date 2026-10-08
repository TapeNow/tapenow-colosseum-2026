import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('all seven instructional references disclose the local/hosted boundary in both languages',()=>{
 for(const page of ['fees.html','gateway.html','manual/index.html','webmcp.html','integrations.html','beta-a.html','receipt-verification.html']){
  const html=fs.readFileSync('public/docs/'+page,'utf8');
  assert.equal((html.match(/data-review-copy="hosted-reference"/g)||[]).length,1,page);
  assert.match(html,/Hosted sign-in, password previews and origin-trial WebMCP are not configured in the local app/,page);
  assert.match(html,/本地应用未配置云端登录、密码预览或 origin-trial WebMCP/,page);
 }
});
test('receipt guide describes fresh local keys without claiming production key history',()=>{
 const html=fs.readFileSync('public/docs/receipt-verification.html','utf8');
 assert.doesNotMatch(html,/production private key has not been rotated|retains the original signing key|没有轮换生产私钥|保留原有签名密钥/);
 assert.match(html,/fresh local signing key/);assert.match(html,/新的本地签名密钥/);
 for(const text of ['Rotation and revocation','轮换与撤销','retired','revoked','independent channel','独立渠道'])assert.ok(html.includes(text),text);
});
