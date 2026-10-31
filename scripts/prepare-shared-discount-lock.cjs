'use strict';
// Overlay the exact captured Staging packages; preserve unrelated module factories and files.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),ts=require('../backend/wallet-service/node_modules/typescript');
const root=path.resolve(__dirname,'..'),dir='/private/tmp/shared-lock-release',merchant=path.resolve(root,'../whizzMerchants-stg');
const read=(k,n)=>cp.execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',`${dir}/${k}.zip`,n],{encoding:'utf8',maxBuffer:20000000});
function factory(s,suffix,source){
 const tags=[...s.matchAll(/^\/\/ ([^\n]+\.(?:js|ts))\n/gm)],hits=tags.filter(m=>m[1].endsWith(suffix));assert.equal(hits.length,1,'unique '+suffix);const hit=hits[0],idx=tags.indexOf(hit),start=hit.index,end=tags[idx+1]?.index??s.length,chunk=s.slice(start,end),ast=ts.createSourceFile('part.js',chunk,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const decl=ast.statements.find(ts.isVariableStatement).declarationList.declarations[0],fn=decl.initializer.arguments?.[0]?.properties?.[0];assert(fn&&ts.isMethodDeclaration(fn),'factory '+suffix);
 source=source.replace(/require\(['"]([^'"]+)['"]\)/g,(original,target)=>{
  if(!target.startsWith('.'))return original;
  const normalized=path.posix.normalize(path.posix.join(path.posix.dirname(hit[1]),target))+'.js';
  const dep=tags.find(m=>m[1]===normalized)||tags.find(m=>m[1].endsWith('/'+path.posix.basename(normalized))&&m[1].includes(path.posix.dirname(normalized).split('/').slice(-2).join('/')));
  if(dep){const variable=/^var ([\w$]+) = __commonJS\(/m.exec(s.slice(dep.index,dep.index+400));assert(variable,'dependency '+target);return variable[1]+'()';}
  const base=path.posix.basename(normalized);const relative=base==='shared-discount-lock.js'?'shared-discount-lock.js':base;
  return 'require(process.env.LAMBDA_TASK_ROOT+'+JSON.stringify('/'+relative)+')';
 });
 source=source.replace(/\bmodule\.exports\b/g,(fn.parameters[1]?.name.text||'module')+'.exports').replace(/\bexports\b(?!\s*:)/g,fn.parameters[0].name.text); // sources use exports only as module/export identifiers
 // Correct module.<exports> after exports identifier rewrite.
 if(fn.parameters[1])source=source.replaceAll(fn.parameters[1].name.text+'.'+fn.parameters[0].name.text,fn.parameters[1].name.text+'.exports');
 return s.slice(0,start+fn.body.getStart(ast)+1)+'\n'+source+'\n'+s.slice(start+fn.body.end-1);
}
const changes={staff:{},owner:{},auth:{},writer:{}};
for(const [k,pairs]of Object.entries({staff:[['commercial-management.js','backend/staff-service/commercial-management.js'],['offers.js','backend/staff-service/offers.js'],['promotions.js','backend/staff-service/promotions.js']],owner:[],auth:[],writer:[]}))for(const [target,source]of pairs)changes[k][target]=fs.readFileSync(path.join(root,source),'utf8');
let staff=read('staff','_discount_review/central-staff/index.js');for(const name of ['offers.js','promotions.js'])staff=factory(staff,'backend/staff-service/'+name,fs.readFileSync(path.join(root,'backend/staff-service',name),'utf8'));changes.staff['_discount_review/central-staff/index.js']=staff;
// Owner's entrypoint is top-level code in the captured bundle; retain all dependencies and replace its handler section only.
let owner=read('owner','_discount_review/merchant-discounts/index.js');const ownerTag='// ../whizzMerchants-stg/backend/functions/discounts/discount_management_handler.js\n';assert.equal(owner.split(ownerTag).length,2);
let source=fs.readFileSync(path.join(merchant,'backend/functions/discounts/discount_management_handler.js'),'utf8');
const oldTail=owner.split(ownerTag)[1],requires={};for(const [sourcePath,name]of [['../shared/discount-engine','require_discount_engine'],['../shared/discount-contract','require_discount_contract'],['../shared/campaign-version',null],['../shared/merchant-lifecycle',null]]){requires[sourcePath]=name?name+'()':`require(process.env.LAMBDA_TASK_ROOT+${JSON.stringify('/shared/'+path.posix.basename(sourcePath)+'.js')})`;}
source=source.replace(/require\(['"]([^'"]+)['"]\)/g,(original,p)=>requires[p]|| (p.startsWith('../shared/')?`require(process.env.LAMBDA_TASK_ROOT+${JSON.stringify('/shared/'+path.posix.basename(p)+'.js')})`:original));
// Kept source is CommonJS and uses the bundle's own module.exports, just like the prior tail.
changes.owner['_discount_review/merchant-discounts/index.js']=owner.split(ownerTag)[0]+ownerTag+source;
for(const k of ['owner','auth']){
 for(const name of ['campaign-version.js','shared-discount-lock.js'])changes[k]['shared/'+name]=fs.readFileSync(path.join(merchant,'backend/functions/shared',name),'utf8');
 let lifecycle=read(k,'shared/merchant-lifecycle.js');assert(lifecycle.includes('expectedRevision:actor.campaignBaseRevision}'));lifecycle=lifecycle.replace('  for(let i=0;i<items.length;i++)if','  const sharingGuards=[];\n  for(let i=0;i<items.length;i++)if').replace('expectedRevision:actor.campaignBaseRevision}','expectedRevision:actor.campaignBaseRevision,lockGuards:sharingGuards}').replace('  for(const item of items){','  items.push(...sharingGuards);\n  for(const item of items){');changes[k]['shared/merchant-lifecycle.js']=lifecycle;
 if(k==='auth')changes.auth['branch_device_discounts.js']=fs.readFileSync(path.join(merchant,'backend/functions/auth/branch_device_discounts.js'),'utf8').replaceAll("require('../shared/","require('./shared/");
}
changes.staff['shared-discount-lock.js']=fs.readFileSync(path.join(root,'backend/staff-service/shared-discount-lock.js'),'utf8');changes.staff['campaign-version.js']=fs.readFileSync(path.join(root,'backend/staff-service/campaign-version.js'),'utf8');
// Preserve the deployed financial composition overlays and patch only the stale-consent branch.
for(const name of ['delivery-agreement-runtime-284.js','_discount_review/user-create-order/index.js']){
 let body=read('writer',name);const re=/if \((policy\.campaignVersion === snapshot\.version && instant\d*\(policy\.effectiveFrom\) === start && instant\d*\(policy\.effectiveTo\) === end\d*)\) \{/g;let count=0;
 body=body.replace(re,(whole,condition,offset)=>{count++;const previous=body.slice(Math.max(0,offset-800),offset),fail=[...previous.matchAll(/return (fail\d*)\("DISCOUNT_FUNDING_UNAUTHORIZED"\)/g)].at(-1)?.[1];assert(fail,'financial fail binding');return `if (!(${condition})) return ${fail}("DISCOUNT_FUNDING_TERMS_CHANGED");\n            ${whole}`;});assert.equal(count,1,'one shared consent condition '+name);
 if(name.includes('user-create-order')){const needle='"DISCOUNT_FUNDING_UNAVAILABLE",';assert(body.includes(needle));body=body.replaceAll(needle,'"DISCOUNT_FUNDING_TERMS_CHANGED", '+needle);}
 changes.writer[name]=body;
}
for(const [k,entries]of Object.entries(changes)){const out=path.join(dir,k+'.changes');fs.mkdirSync(out,{recursive:true});for(const [name,content]of Object.entries(entries)){const dest=path.join(out,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);cp.execFileSync(process.execPath,['--check',dest]);}}
fs.writeFileSync(path.join(dir,'changes.json'),JSON.stringify(Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,Object.keys(v)])),null,2));console.log(JSON.stringify({prepared:true,files:Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,Object.keys(v)]))}));
