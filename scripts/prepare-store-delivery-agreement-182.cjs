'use strict';
// Review-only AST overlays of the captured live ZIPs; no AWS writes.
const fs=require('fs'),path=require('path'),cp=require('child_process'),ts=require('../backend/wallet-service/node_modules/typescript');
const out='/private/tmp/store-agreement-182',root=path.resolve(__dirname,'..');
const selected=new Set(['allocateDeliveryFundedOrder','createStagingDeliveryCampaignBudget','createStagingCommercialSource','createStagingDeliveryPromotionSelection','createStagingStorefrontPreview','composeQuoteOrderOperations']);
const inventory=JSON.parse(fs.readFileSync(path.join(out,'inventory.json'))),result=[];
for(const entry of inventory){
 const folder=path.join(out,entry.name+'.overlay');fs.mkdirSync(folder,{recursive:true});
 const candidates=JSON.parse(cp.execFileSync('python3',['-c',`import zipfile,json,sys
z=zipfile.ZipFile(sys.argv[1]);result={}
for n in z.namelist():
 if n.endswith('.js') and 'node_modules/' not in n:
  s=z.read(n).decode(errors='replace')
  if any('function '+x in s for x in ['allocateDeliveryFundedOrder','createStagingDeliveryCampaignBudget','createStagingCommercialSource','createStagingDeliveryPromotionSelection','createStagingStorefrontPreview','composeQuoteOrderOperations']):result[n]=s
print(json.dumps(result))`,path.join(out,entry.name+'.zip')],{encoding:'utf8',maxBuffer:50000000}));
 const changes={},patches=[];
 for(const [n,source] of Object.entries(candidates)){
  if(entry.name==='staging-wizz-staff-service')continue;
  if(![...selected].some(name=>source.includes('function '+name)))continue;
  const ast=ts.createSourceFile(n,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits=[];
  function visit(node){
if(entry.name==='WizzUser-CreateOrder-staging'&&n==='functions/create-order/commercial-runtime.js'&&ts.isIfStatement(node)){
 const predicate=node.expression.getText(ast);
 if(predicate.includes('DELIVERY_BUDGET#')&&predicate.includes('DELIVERY_USAGE#')){
  const relative=path.posix.relative(path.posix.dirname(n),'agreement-runtime182.js');
  edits.push({start:node.expression.getStart(ast),end:node.expression.end,body:require('./store-agreement-commit-overlay.cjs').agreementPredicate(predicate,relative)});
  patches.push({file:n,function:'quoteOrderCommitAgreementEvidence',canonical:'hasStoreAgreementOrderEvidence'});
 }
}
if(ts.isFunctionDeclaration(node)&&node.name){const actual=node.name.text,canonical=actual.replace(/\d+$/,'');if(selected.has(canonical)){if(node.parameters.length!==1||!ts.isIdentifier(node.parameters[0].name))throw Error('UNEXPECTED_FUNCTION_SIGNATURE');const arg=node.parameters[0].name.text;let relative=path.posix.relative(path.posix.dirname(n),'agreement-runtime182.js');if(!relative.startsWith('.'))relative='./'+relative;let bind='';
if(!['allocateDeliveryFundedOrder','composeQuoteOrderOperations'].includes(canonical)){
 const body=node.body.getText(ast);const namespace=body.match(/new\s+([A-Za-z_$][\w$]*)\.(?:GetCommand|QueryCommand|TransactWriteCommand)\b/)?.[1];
 if(!namespace)throw Error('HOST_SDK_NAMESPACE_MISSING:'+n+':'+actual);
 bind=`require(${JSON.stringify(relative.replace('agreement-runtime182.js','agreement-sdk182.js'))}).bind(${namespace}); `;
}
edits.push({start:node.getStart(ast),end:node.end,body:`function ${actual}(${arg}) { ${bind}return require(${JSON.stringify(relative)}).${canonical}(${arg}); }`});patches.push({file:n,function:actual,canonical});return;}}ts.forEachChild(node,visit);}visit(ast);
  if(edits.length){let s=source;for(const e of edits.sort((a,b)=>b.start-a.start))s=s.slice(0,e.start)+e.body+s.slice(e.end);
   if(entry.name==='WizzUser-CreateOrder-staging'&&n==='functions/create-order/commercial-runtime.js'){
    const needle='minimumPolicy.assertMinimumOrder(minimumBranch, catalog.goodsGross.minorAmount);';if(s.includes(needle))s=s.replace(needle,'if(commercialMode!=="REQUIRED")'+needle);else if(s.includes('minimumPolicy.assertMinimumOrder'))throw Error('MINIMUM_HANDLER_ANCHOR');
   }
   changes[n]=s;}

 }
 if(patches.length)for(const n of ['agreement-runtime182.js','agreement-sdk182.js'])changes[n]=fs.readFileSync(path.join(out,n),'utf8');
 if(entry.name==='staging-wizz-staff-service'){
  changes['commercial-management.js']=fs.readFileSync(path.join(root,'backend/staff-service/commercial-management.js'),'utf8');
  for(const n of fs.readdirSync(path.join(root,'backend/staff-service/pricing-runtime')).filter(n=>n.endsWith('.js')))changes['pricing-runtime/'+n]=fs.readFileSync(path.join(root,'backend/staff-service/pricing-runtime',n),'utf8');
 }
 if(['WizzUser-GetBusiness-staging','WizzUser-GetBusinesses-staging'].includes(entry.name))changes['functions/shared/storefront-facts-170.js']=fs.readFileSync(path.join(root,'../wizzuser-stg/backend/src/functions/shared/storefront-facts-170.js'),'utf8');
 if(!Object.keys(changes).length)continue;
 for(const [n,s]of Object.entries(changes)){const file=path.join(folder,n);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,s);cp.execFileSync(process.execPath,['--check',file],{stdio:'pipe'});}
 fs.writeFileSync(path.join(folder,'changes.json'),JSON.stringify(Object.keys(changes)));
 result.push({...entry,patches,overlay:folder});
}
fs.writeFileSync(path.join(out,'overlays.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result.map(x=>({name:x.name,patches:x.patches}))));
