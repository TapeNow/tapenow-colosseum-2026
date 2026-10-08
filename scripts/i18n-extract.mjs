import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
export const normalizeSource=text=>text.replace(/\s+/g,' ').trim();
export function extractCatalog(source,fileName='source.tsx') {
  const ast=ts.createSourceFile(fileName,source,ts.ScriptTarget.Latest,true,fileName.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),found=[];
  function add(node,text,kind){if(!/\p{Script=Han}/u.test(text))return;found.push({source:normalizeSource(text),kind,start:node.getStart(ast),end:node.end,line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1});}
  function visit(node){
    if(ts.isJsxText(node))add(node,node.text,'jsx');
    else if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)){
      const p=node.parent;
      if(!(ts.isPropertyAssignment(p)&&p.name===node)&&!ts.isImportDeclaration(p)&&!ts.isLiteralTypeNode(p))add(node,node.text,'literal');
    }else if(ts.isTemplateExpression(node))add(node,node.head.text+node.templateSpans.map((span,i)=>`{${i}}`+span.literal.text).join(''),'template');
    ts.forEachChild(node,visit);
  }visit(ast);return found;
}
export function extractTree(dir='src') {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const file=path.join(dir,entry.name);return entry.isDirectory()?extractTree(file):/\.tsx?$/.test(file)&&!file.endsWith('i18n.tsx')?extractCatalog(fs.readFileSync(file,'utf8'),file).map(item=>({...item,file})):[];});
}
// Migration deliberately touches only JSX text and accessible string attributes.
// Other literals may be data, identifiers, code examples, or module-level UI models.
export function migrateSource(source,fileName='source.tsx') {
 const ast=ts.createSourceFile(fileName,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),edits=[];
 function visit(node){
  if(ts.isJsxText(node)&&/\p{Script=Han}/u.test(node.text))edits.push({start:node.getStart(ast),end:node.end,text:'{t('+JSON.stringify(normalizeSource(node.text))+')}'});
  if(ts.isStringLiteral(node)&&ts.isJsxAttribute(node.parent)&&['title','placeholder','aria-label','alt','label','description'].includes(node.parent.name.getText(ast))&&/\p{Script=Han}/u.test(node.text))edits.push({start:node.getStart(ast),end:node.end,text:'{t('+JSON.stringify(normalizeSource(node.text))+')}'});
  ts.forEachChild(node,visit);
 }visit(ast);
 let output=source;for(const edit of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,edit.start)+edit.text+output.slice(edit.end);
 if(edits.length&&!/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*["']\.\/i18n["']/.test(source))output='import { t } from "./i18n";\n'+output;
 return {source:output,changes:edits.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
 const args=process.argv.slice(2),dir=args.find(a=>!a.startsWith('--'))||'src';
 const occurrences=extractTree(dir),unique=[...new Set(occurrences.map(x=>x.source))].sort();
 if(args.includes('--apply')){
  const files=[...new Set(occurrences.map(o=>o.file))];const changed=[];
  for(const file of files){const result=migrateSource(fs.readFileSync(file,'utf8'),file);if(result.changes){fs.writeFileSync(file,result.source);changed.push({file,changes:result.changes});}}
  process.stdout.write(JSON.stringify({changed,remaining:'Review model display sites and dynamic messages manually; subscribe render roots with useLanguage.'},null,2)+'\n');
 }else process.stdout.write(JSON.stringify({uniqueCount:unique.length,occurrences,translations:Object.fromEntries(unique.map(s=>[s,'']))},null,2)+'\n');
}
