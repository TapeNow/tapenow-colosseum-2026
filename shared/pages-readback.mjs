export const pagesPublicPath=path=>{
  const encoded=value=>'/'+value.split('/').map(encodeURIComponent).join('/');
  return path==='index.html'?'/':path.endsWith('/index.html')?encoded(path.slice(0,-10)):path.endsWith('.html')?encoded(path.slice(0,-5)):encoded(path);
};
export async function verifyPagesManifest(url,plan,{fetchImpl=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const homepage=plan.files.find(f=>f.path==='index.html').sha256;
  let pending=[...plan.files.map(f=>({path:f.path,expected:f.sha256})),...plan.removed.map(path=>({path,removed:true}))];
  for(let attempt=0;attempt<2 && pending.length;attempt++) {
    const failed=[];let next=0;
    await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{
      while(next<pending.length) {
        const item=pending[next++];let matches=false;
        try {
          // Keep the visitor's real cache key. A cache-busting query can hide stale assets.
          const response=await fetchImpl(url+pagesPublicPath(item.path),{redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(10000)});
          if(item.removed && [404,410].includes(response.status)){matches=true;await response.body?.cancel();}
          else if(response.ok) {
            const digest=await crypto.subtle.digest('SHA-256',await response.arrayBuffer());
            const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
            matches=item.removed?hash===homepage:hash===item.expected;
          }else await response.body?.cancel();
        }catch{}
        if(!matches)failed.push(item);
      }
    }));
    pending=failed;
    if(pending.length && attempt===0)await pause(1000);
  }
  return {filesChecked:plan.files.length,removedChecked:plan.removed.length,failed:pending.map(({path,removed})=>({path,removed:!!removed})),at:new Date().toISOString()};
}
