import test from 'node:test';
import assert from 'node:assert/strict';
import {FREE_LIMITS,BETA_LIMITS} from '../server/beta-policy.mjs';
import {reservePublication,completePublication,publicationUsage} from '../server/publication-quota.mjs';
import {beginPublicExposure} from '../cloud/publication-policy.mjs';

const jan=Date.parse('2026-01-15T12:00:00Z'),feb=Date.parse('2026-02-01T00:00:00Z');
const fixture=()=>{
  const state={releases:[]},store={state,save(){}};
  const add=i=>{const release={id:'d-'+String(i).padStart(12,'0'),projectId:'p-000000000001',manifestHash:'hash'};state.releases.push(release);return release;};
  return {state,store,add};
};

test('free publication quota reserves before exposure, counts verified releases once, and blocks the eleventh',async()=>{
  const {store,add}=fixture();let commits=0;
  const env={ARTIFACTS:{get:async()=>null}},user={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
  const monthNow=Date.now();
  for(let i=0;i<10;i++){
    const release=add(i);
    reservePublication(store,release,FREE_LIMITS,monthNow);
    if(i<8)completePublication(store,release,monthNow+1000);
    reservePublication(store,release,FREE_LIMITS,monthNow); // retry/restore is not another slot
  }
  assert.deepEqual(publicationUsage(store,FREE_LIMITS,monthNow),{month:new Date(monthNow).toISOString().slice(0,7),limit:10,successful:8,pending:2,remaining:0});
  const blocked=add(10);
  await assert.rejects(beginPublicExposure(env,store,user,blocked,'chain-signing',async()=>{commits++;},FREE_LIMITS),{status:429});
  assert.equal(blocked.publicExposure,undefined);
  assert.equal(commits,0);
});

test('new UTC month resets slots; existing public release and beta workspaces do not consume free slots',()=>{
  const {store,add}=fixture();
  for(let i=0;i<10;i++)reservePublication(store,add(i),FREE_LIMITS,jan);
  const febRelease=add(10);reservePublication(store,febRelease,FREE_LIMITS,feb);
  assert.equal(publicationUsage(store,FREE_LIMITS,feb).remaining,9);
  const earlier=store.state.releases[0];reservePublication(store,earlier,FREE_LIMITS,feb);
  assert.equal(earlier.publicationQuota.month,'2026-01');
  assert.equal(publicationUsage(store,FREE_LIMITS,feb).remaining,9);
  const old=add(11);old.publicExposure={kind:'chain-signing',at:'2025-12-01T00:00:00Z'};
  reservePublication(store,old,FREE_LIMITS,feb);
  assert.equal(old.publicationQuota,undefined);
  assert.equal(publicationUsage(store,FREE_LIMITS,feb).remaining,9);
  reservePublication(store,add(12),BETA_LIMITS,feb);
  assert.equal(publicationUsage(store,BETA_LIMITS,feb),null);
});
