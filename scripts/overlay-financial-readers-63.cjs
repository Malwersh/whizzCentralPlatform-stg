'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),ts=require('../backend/wallet-service/node_modules/typescript');
const root=path.resolve(__dirname,'..'),r='/private/tmp/finance63',read=(k,n)=>cp.execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',r+'/'+k+'.zip',n],{encoding:'utf8',maxBuffer:20000000});
function moduleRange(s,suffix){const tag=new RegExp('^// [^\\n]*'+suffix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\n','gm'),hits=[...s.matchAll(tag)];assert.equal(hits.length,1,'UNIQUE_MODULE '+suffix);const start=hits[0].index;const tail=s.slice(start+hits[0][0].length),end=tail.search(/^\/\/ \S+\.(?:[cm]?js|ts)$/m);return [start,end<0?s.length:start+hits[0][0].length+end];}
function wrapper(s,suffix,body,raw=false){const [start,end]=moduleRange(s,suffix),chunk=s.slice(start,end),ast=ts.createSourceFile('module.js',chunk,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let method;function walk(n){if(ts.isMethodDeclaration(n)&&n.body){assert(!method);method=n;}ts.forEachChild(n,walk);} // only the commonJS wrapper is at object property level
 const call=ast.statements.find(n=>ts.isVariableStatement(n));const decl=call.declarationList.declarations[0];const obj=decl.initializer.arguments[0];method=obj.properties[0];assert(ts.isMethodDeclaration(method));const exportsName=method.parameters[0].name.text,old=method.body.getText(ast);const imports=Object.fromEntries([...old.matchAll(/(?:var|const) (\w+_\d+) = ([\w$]+\(\));/g)].map(m=>[m[1],m[2]]));
 if(!raw)body=body.replace(/\bexports\b/g,exportsName).replace(/((?:var|const) (\w+_\d+) = )require\(["'][^"']+["']\)/g,(_,a,name)=>{assert(imports[name],'IMPORT_BINDING '+name);return a+imports[name];});
 else{
  const sdk=old.match(/var \{ GetCommand[^\n]+ = ([\w$]+\(\));/)[1];const maps={'@aws-sdk/lib-dynamodb':sdk,'./discount-engine':'require_discount_engine()','./offer-eligibility':'require_offer_eligibility()','./campaign-version':'require("../shared/campaign-version")'};
  body=body.replace(/require\(['"]([^'"]+)['"]\)/g,(_,p)=>{assert(maps[p],'IMPORT_PATH '+p);return maps[p];}).replace(/\bmodule\.exports\b/g,method.parameters[1].name.text+'.exports');
 }
 assert(!/require\(["'](?:\.\/money|\.\/order)/.test(body));
 const at=start+method.body.getStart(ast)+1,stop=start+method.body.end-1;return s.slice(0,at)+'\n'+body+'\n'+s.slice(stop);
}
const inv=JSON.parse(fs.readFileSync(r+'/inventory.json')),packages={};
const money=fs.readFileSync(root+'/backend/wallet-service/dist/money.js','utf8'),pricing=fs.readFileSync(root+'/backend/wallet-service/dist/deliveryPricing.js','utf8');
for(const k of ['quote','driver','wave','timeout','writer']){
 const changes={};
 if(k==='quote'){
  const old=read(k,'index.js'),built=fs.readFileSync(r+'/quote.built.js','utf8'),suffix='delivery-quotes/runtime.js',a=moduleRange(old,suffix),b=moduleRange(built,suffix);assert.equal(old.slice(0,a[0])+old.slice(a[1]),built.slice(0,b[0])+built.slice(b[1]),'QUOTE_OUTER_HANDLER_CHANGED');changes['index.js']=built;
 }else if(k==='writer'){
  let s=read(k,'functions/create-order/commercial-runtime.js');
  for(const n of ['money','deliveryPricing','orderCommercialPricing','orderCommercialSource'])s=wrapper(s,'quote-runtime/'+n+'.js',fs.readFileSync(root+'/backend/wallet-service/dist/'+n+'.js','utf8'));
  s=wrapper(s,'shared/discount-reservation.js',fs.readFileSync(root+'/../wizzuser-stg/backend/src/functions/shared/discount-reservation.js','utf8'),true);
  const old='deliveryFee: moneyFromMinor(deliveryFee)';assert.equal(s.split(old).length,2,'PREVIEW_MONEY_BINDING_CHANGED');s=s.replace(old,old+', driverTip: moneyFromMinor(tip)');
  changes['functions/create-order/commercial-runtime.js']=s;
  for(const n of ['money','deliveryPricing','orderCommercialPricing','orderCommercialSource'])changes['functions/create-order/quote-runtime/'+n+'.js']=fs.readFileSync(root+'/../wizzuser-stg/backend/src/functions/create-order/quote-runtime/'+n+'.js','utf8');
 }else{
  const file=k==='driver'?'index.js':'financial-runtime.js';let s=read(k,file);
  for(const n of ['money','deliveryPricing']){
   const [a,b]=moduleRange(s,'src/'+n+'.ts'),exports=Object.keys(require(root+'/backend/wallet-service/dist/'+n));const prefix='__coordinated_'+n;
   s=s.slice(0,a)+'// backend/wallet-service/src/'+n+'.ts\nvar '+prefix+'=require("./pricing-runtime/'+n+'");\n'+exports.map(e=>'var '+e+'='+prefix+'.'+e+';').join('\n')+'\n\n'+s.slice(b);
  }
  changes[file]=s;changes['pricing-runtime/money.js']=money;changes['pricing-runtime/deliveryPricing.js']=pricing;
 }
 const replacements={};for(const [file,data]of Object.entries(changes)){const p=path.join(r,'overlays',k,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);cp.execFileSync(process.execPath,['--check',p]);replacements[file]=p;}
 const names=JSON.parse(cp.execFileSync('python3',['-c','import zipfile,json,sys;print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))',r+'/'+k+'.zip'],{encoding:'utf8',maxBuffer:5000000})); const added=Object.fromEntries(Object.entries(replacements).filter(([n])=>!names.includes(n))); for(const n of Object.keys(added))delete replacements[n];
 const report=JSON.parse(cp.execFileSync('python3',[root+'/scripts/quote-release-archive.py'],{input:JSON.stringify({mode:'overlay',source:r+'/'+k+'.zip',destination:r+'/'+k+'.candidate.zip',expectedCodeSha256:inv[k].codeSha256,replacements,additions:added}),encoding:'utf8'}));assert(!report.error,JSON.stringify(report));packages[k]=report;
}
fs.writeFileSync(r+'/preparation.json',JSON.stringify({part:63,base:inv,packages,activationPerformed:false,environmentChanges:false,iamChanges:false},null,2));console.log(JSON.stringify({prepared:Object.keys(packages),financialCodModulePreservedOutsidePricingBlocks:true,activationPerformed:false}));
