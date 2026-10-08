import {demand,sha} from './core.mjs';
const categories=['script','font','image','api','unknown'];
export function dependencyUrl(value) {
  try{const u=new URL(value.startsWith('//')?'https:'+value:value);if(!['https:','http:'].includes(u.protocol))return null;
    // Origin-only reporting also avoids tokens embedded in path segments.
    return u.origin;
  }catch{return null;}
}
function category(url,context='') {
  if(/\.(?:woff2?|ttf|otf)(?:[?#]|$)/i.test(url)||/font/i.test(context))return 'font';
  if(/\.(?:png|jpe?g|gif|webp|svg|ico|avif)(?:[?#]|$)/i.test(url)||/<img|image|srcset/i.test(context))return 'image';
  if(/\.(?:m?js)(?:[?#]|$)/i.test(url)||/<script|import\s/i.test(context))return 'script';
  if(/fetch\s*\(|axios|api/i.test(context))return 'api';
  return 'unknown';
}
export function dependencyInventory(files,declarations=[]) {
  demand(Array.isArray(files)&&files.length<=500,'文件数量超限');
  demand(Array.isArray(declarations)&&declarations.length<=100,'声明数量超限');
  const entries=new Map();let scannedBytes=0,scannedFiles=0,truncated=false;
  function add(raw,kind,source){const origin=dependencyUrl(raw);if(!origin)return;if(entries.size>=200){truncated=true;return;}const key=origin+'|'+kind;const old=entries.get(key);if(old){if(!old.sources.includes(source))old.sources.push(source);return;}entries.set(key,{origin,category:kind,sources:[source]});}
  for(const file of files){if(!/\.(?:html?|css|[cm]?js|jsx|tsx?)$/i.test(file.path||''))continue;
    if(typeof file.base64!=='string'){truncated=true;continue;}
    if(file.base64.length>1400000||scannedBytes+Math.ceil(file.base64.length*3/4)>4000000){truncated=true;continue;}
    const text=Buffer.from(file.base64,'base64').toString('utf8');scannedBytes+=Buffer.byteLength(text);scannedFiles++;
    // Static heuristic only: no script evaluation or network access.
    const pattern=/(?:https?:)?\/\/[^\s"'`<>\\)]+/g;let m,count=0;
    while((m=pattern.exec(text))){if(++count>2000){truncated=true;break;}add(m[0],category(m[0],text.slice(Math.max(0,m.index-60),m.index)), 'artifact');}
  }
  for(const d of declarations){demand(d&&typeof d.url==='string'&&d.url.length<=2048&&categories.includes(d.category),'依赖声明无效');demand(dependencyUrl(d.url),'依赖 URL 无效');add(d.url,d.category,'declared');}
  const dependencies=[...entries.values()].sort((a,b)=>(a.origin+'|'+a.category).localeCompare(b.origin+'|'+b.category));
  return {dependencies,scannedFiles,scannedBytes,truncated,scope:'静态 HTML/CSS/JS URL 启发式与用户声明；不包含完整运行时依赖发现，未请求外部资源；仅显示来源站点',digest:sha(JSON.stringify(dependencies))};
}
