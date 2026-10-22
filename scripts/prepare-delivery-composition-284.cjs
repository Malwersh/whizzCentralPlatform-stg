'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const esbuild=require('../backend/wallet-service/node_modules/esbuild'),{patch}=require('./patch-delivery-composition-host-284.cjs');
const root=path.resolve(__dirname,'..'),out=process.argv[2],user=path.resolve(root,'../wizzuser-stg');
if(!out||!path.isAbsolute(out))throw Error('Absolute pinned inventory directory required');
const runtime=path.join(out,'delivery-agreement-runtime-284.js');
esbuild.buildSync({entryPoints:[path.join(root,'backend/wallet-service/src/deliveryAgreementCompositionRuntime.ts')],bundle:true,platform:'node',target:'node20',keepNames:true,outfile:runtime,logLevel:'silent'});
const plans=[];
for(const row of JSON.parse(fs.readFileSync(path.join(out,'inventory.json')))){
 const changes={},proofs=[];
 for(const hit of row.hits){
  const source=fs.readFileSync(path.join(out,'source',row.function,hit.file),'utf8');
  if(row.function==='WizzUser-CreateOrder-staging'&&hit.file==='_discount_review/user-create-order/index.js')continue;
  let relative=path.posix.relative(path.posix.dirname(hit.file),'delivery-agreement-runtime-284.js');if(!relative.startsWith('.'))relative='./'+relative;
  const result=patch(source,relative);
  if(result.proofs.length){const target=path.join(out,'candidate',row.function,hit.file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,result.source);cp.execFileSync(process.execPath,['--check',target]);changes[hit.file]=target;proofs.push(...result.proofs.map(p=>({...p,file:hit.file})));}
 }
 if(row.function==='WizzUser-CreateOrder-staging'){
  const file='_discount_review/user-create-order/index.js',target=path.join(out,'candidate',row.function,file);fs.mkdirSync(path.dirname(target),{recursive:true});
  esbuild.buildSync({entryPoints:[path.join(user,'backend/src/functions/create-order/index.js')],bundle:true,platform:'node',target:'node20',keepNames:true,outfile:target,nodePaths:[path.join(root,'backend/wallet-service/node_modules'),path.join(root,'node_modules'),path.join(user,'backend/node_modules')],logLevel:'silent'});
  changes[file]=target;proofs.push({file,mode:'CANONICAL_CREATE_ORDER_WITH_AGREEMENT_FIRST_COMPOSITION'});
 }
 if(Object.keys(changes).length)changes['delivery-agreement-runtime-284.js']=runtime;
 plans.push({...row,changes,proofs,publish:Object.keys(changes).length>0});
}
fs.writeFileSync(path.join(out,'plans.json'),JSON.stringify(plans,null,2)+'\n');
console.log(JSON.stringify(plans.map(p=>({function:p.function,publish:p.publish,changed:Object.keys(p.changes),factories:p.proofs.length})),null,2));
