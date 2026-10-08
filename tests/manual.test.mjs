import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {signupPolicy} from '../cloud/admission.mjs';

const html = fs.readFileSync('public/docs/manual/index.html', 'utf8');
const script = fs.readFileSync('public/docs/manual/manual.js', 'utf8');
const chapters = vm.runInNewContext(script.slice(0, script.indexOf('const root=')) + '\nchapters');

test('manual release labels match the package and preserve historical screenshot provenance', () => {
  const {version} = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const meta = html.match(/<div class="meta">(.*?)<\/div>/s)[1];
  const footer = html.match(/<footer class="manual-footer">(.*?)<\/footer>/s)[1];
  for (const part of [meta, footer]) {
    for (const locale of ['zh', 'en']) {
      const text = part.match(new RegExp(`<span class="l-${locale}">(.*?)</span>`, 's'))[1];
      assert.ok(text.includes(version), `${locale} release label must match ${version}`);
    }
    assert.doesNotMatch(part, /Invitation Beta/);
  }
  assert.match(footer, /0\.9\.1 interface/);
  assert.match(footer, /0\.9\.1 真实界面/);
});

test('manual onboarding reflects documented admission policy example without promising available seats', () => {
  const config = JSON.parse(fs.readFileSync('examples/admission-policy.json', 'utf8'));
  const policy = signupPolicy(config.vars);
  assert.equal(policy.mode, 'open');
  const account = chapters.find(c => c.id === 'account');
  for (const locale of ['en', 'zh']) {
    assert.ok(account[locale].includes(String(policy.dailyLimit)));
    assert.ok(account[locale].includes(String(policy.totalLimit)));
  }
  assert.match(account.en, /human verification/);
  assert.match(account.zh, /人机验证/);
  assert.match(account.en, /Returning accounts keep their seats/);
  assert.match(account.zh, /已有名额的账号登录不再占用新名额/);
  const troubleshooting = html.slice(html.indexOf('id="troubleshooting"'), html.indexOf('<footer'));
  assert.match(troubleshooting, /daily limit/);
  assert.match(troubleshooting, /phase total/);
  assert.match(troubleshooting, /每日名额/);
  assert.match(troubleshooting, /总名额/);
  assert.doesNotMatch(troubleshooting, /address is invited|inviter|邮箱已受邀|邀请状态|邀请你的/);
});

test('manual reference headings and task chapters have complete English and Chinese copy', () => {
  const labels = [...html.matchAll(/<div class="chapter-label">(.*?)<\/div>/gs)];
  assert.equal(labels.length, 2);
  for (const [, label] of labels) {
    assert.match(label, /class="l-zh"/);
    assert.match(label, /class="l-en"/);
    const english = label.replace(/<span class="l-zh">.*?<\/span>/gs, '');
    assert.doesNotMatch(english, /\p{Script=Han}/u);
  }
  for (const chapter of chapters) {
    assert.ok(chapter.en && chapter.zh, chapter.id);
    assert.doesNotMatch(chapter.en + chapter.title[1], /\p{Script=Han}/u, chapter.id);
    assert.match(chapter.zh, /\p{Script=Han}/u, chapter.id);
  }
});
