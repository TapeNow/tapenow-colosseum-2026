import assert from 'node:assert/strict';
// Only the Supabase status endpoint is mocked. The production status helper,
// serving guard and cache ordering remain real in each caller.
export function projectStatusFixture(t,ownerId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'){
  const state={suspended:false,reason:'fixture suspension',available:true,calls:[]};
  const env={SUPABASE_URL:'https://status.fixture.test',SUPABASE_ADMIN_KEY:'fixture-admin'};
  t.mock.method(globalThis,'fetch',async(url,init={})=>{
    const u=new URL(url);assert.equal(u.origin,env.SUPABASE_URL);assert.equal(u.pathname,'/rest/v1/tapenow_project_status');
    assert.equal(init.headers.Authorization,'Bearer '+env.SUPABASE_ADMIN_KEY);assert.equal(init.headers.apikey,env.SUPABASE_ADMIN_KEY);
    assert.equal(u.searchParams.get('environment'),'eq.development');assert.equal(u.searchParams.get('owner_id'),'eq.'+ownerId);assert.match(u.searchParams.get('project_id'),/^eq\.p-[a-f0-9]{12}$/);
    state.calls.push(u.href);return state.available?Response.json([{suspended:state.suspended,reason:state.reason}]):new Response(null,{status:503});
  });return {env,state};
}
