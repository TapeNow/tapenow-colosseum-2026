import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'MANIFEST.json'),'utf8'));
const listed=new Set();
for(const file of manifest.files){
  assert.ok(!listed.has(file.path),'Duplicate manifest path');listed.add(file.path);
  const target=path.resolve(root,file.path);
  assert.ok(target.startsWith(root+path.sep),'Unsafe manifest path');
  assert.ok(!fs.lstatSync(target).isSymbolicLink(),'Symlinks are not permitted');
  const bytes=fs.readFileSync(target);
  assert.equal(bytes.length,file.bytes,file.path+' size');
  assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path+' hash');
}
// Local build/test state is expected after running README commands, never part of the export.
const runtime=new Set(['node_modules','dist','.data','.omo']);
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const rel=path.relative(root,path.join(dir,entry.name)).replaceAll(path.sep,'/');
  if(dir===root&&runtime.has(entry.name))continue;
  assert.ok(!entry.isSymbolicLink(),'Unexpected symlink '+rel);
  if(entry.isDirectory())walk(path.join(dir,entry.name));
  else assert.ok(listed.has(rel)||['MANIFEST.json','MANIFEST.sha256'].includes(rel),'Unlisted export file '+rel);
}}
walk(root);
const expected=fs.readFileSync(path.join(root,'MANIFEST.sha256'),'utf8').split(/\s+/)[0];
assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,'MANIFEST.json'))).digest('hex'),expected);
console.log(`PASS: ${listed.size} payload files match the export manifest; no unexpected export files.`);
