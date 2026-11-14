'use strict';
// Prepare overlays from saved live ZIPs. Preserve all other entries/configuration.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),ts=require('../backend/wallet-service/node_modules/typescript');
const root=path.resolve(__dirname,'..'),base='/private/tmp/full-cash-208',live=base+'/live',runtime=base+'/runtime',out=base+'/packages';fs.mkdirSync(out,{recursive:true,mode:0o700});
const financialFunctions=require('./check-finance-rollout-deployment.cjs').FUNCTIONS;
const names=[...financialFunctions,'staging-wizz-wallet-service','staging-wizz-wallet-lifecycle','staging-account-deletion-requests','staging-account-deletion-worker','staging-account-deletion-financial-expiry'];
const read=n=>fs.readFileSync(path.join(runtime,n+'.js'),'utf8'),source=f=>fs.readFileSync(path.resolve(root,f),'utf8'),sha=b=>crypto.createHash('sha256').update(b).digest('base64');
const results=[];
for(const name of names){
 const config=JSON.parse(fs.readFileSync(path.join(live,name+'.config.private.json'))),zip=path.join(live,name+'.zip');if(sha(fs.readFileSync(zip))!==config.CodeSha256)throw Error('LIVE_ZIP_HASH_MISMATCH:'+name);
 const entries=JSON.parse(cp.execFileSync('python3',['-c',"import zipfile,json,sys\nz=zipfile.ZipFile(sys.argv[1]);print(json.dumps({n:z.read(n).decode() for n in z.namelist() if n.endswith('.js') and 'node_modules/' not in n}))",zip],{encoding:'utf8',maxBuffer:180000000}));const changes={},notes=[];
 if(name==='staging-driver-financial-accept')changes['index.js']=read('financial-runtime');
 if(name==='staging-cod-integration')changes['index.js']=read('cod-integration-runtime');
 if(name==='staging-merchant-response-99')changes['index.js']=read('merchant-response-runtime');
 for(const file of Object.keys(entries)){
  if(file==='financial-runtime.js')changes[file]=read('financial-runtime');
  if(file==='dispatch-cycle-runtime.js')changes[file]=read('dispatch-cycle-runtime');
  if(file.endsWith('finance-rollout.js'))changes[file]=read('finance-rollout');
 }
 if(name==='WizzUser-CreateOrder-staging')changes['functions/create-order/commercial-runtime.js']=read('commercial-runtime');
 if(name==='order-receiver-merchant-orders-staging-v1'){
  changes['merchant_pending_response.js']=read('merchant-pending-runtime');
  const before=entries['merchant_order_handler.js'],needle="enableDeliveryFunding:process.env.FINANCIAL_DELIVERY_FUNDING_MODE==='REQUIRED',authenticate:";
  if(!before.includes(needle))throw Error('MERCHANT_FLAG_ANCHOR_CHANGED');changes['merchant_order_handler.js']=before.replace(needle,"enableDeliveryFunding:process.env.FINANCIAL_DELIVERY_FUNDING_MODE==='REQUIRED',enableFullCash:process.env.FINANCIAL_SETTLEMENT_MODEL==='FULL_CASH_AT_DELIVERY_V1',authenticate:");
 }
 if(name==='DriversApi-staging')for(const file of ['financial-order-view.js','legacy-order-policy.js'])changes[file]=source('../whizzDrivers-stg/backend/'+file);
 if(name==='staging-wizz-staff-service')for(const file of ['settlement-runtime.js','settlement-schedules.js','settlement-orders.js'])changes[file]=source('backend/staff-service/'+file);
 if(name==='staging-wizz-wallet-service'||name==='staging-wizz-wallet-lifecycle')for(const file of ['holdService','settlementService','walletLifecycle','ledgerEffects','reconciliation'])changes['dist/'+file+'.js']=source('backend/wallet-service/dist/'+file+'.js');
 if(name.startsWith('staging-account-deletion-'))for(const file of ['cod-retention.js','customer-cleanup.js','financial-purge.js','settlement-retention.js','settlement-schedule-inventory.js'])if(entries[file])changes[file]=source('backend/account-deletion/'+file);
 // Eliminate embedded old scope admission without replacing the host's other code.
 for(const [file,code]of Object.entries(entries)){
  if(changes[file]!==undefined||! /function createFinanceRollout\d*\(/.test(code))continue;
  const ast=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits=[];
  function visit(node){if(ts.isFunctionDeclaration(node)&&node.name&&/^createFinanceRollout\d*$/.test(node.name.text)){
   if(node.parameters.length!==1||!ts.isIdentifier(node.parameters[0].name))throw Error('ROLLOUT_FACTORY_SIGNATURE_CHANGED:'+name+':'+file);
   let relative=path.posix.relative(path.posix.dirname(file),'full-cash-rollout-208.js');if(!relative.startsWith('.'))relative='./'+relative;
   edits.push({start:node.getStart(ast),end:node.end,body:`function ${node.name.text}(${node.parameters[0].name.text}) { return require(${JSON.stringify(relative)}).createFinanceRollout(${node.parameters[0].name.text}); }`});return;}ts.forEachChild(node,visit);}visit(ast);
  if(edits.length){let next=code;for(const e of edits.sort((a,b)=>b.start-a.start))next=next.slice(0,e.start)+e.body+next.slice(e.end);changes[file]=next;changes['full-cash-rollout-208.js']=read('finance-rollout');notes.push({file,replacedScopeFactories:edits.length});}
 }
 if(name==='staging-wizz-staff-service')changes['settlement-evidence-fields.json']=source('backend/staff-service/settlement-evidence-fields.json');
 if(financialFunctions.includes(name)){
  const entry=config.Handler.slice(0,config.Handler.lastIndexOf('.'))+'.js';
  let relative=path.posix.relative(path.posix.dirname(entry),'finance-rollout-config-208.js');if(!relative.startsWith('.'))relative='./'+relative;
  changes[entry]=`'use strict';\nrequire(${JSON.stringify(relative)}).restoreFinanceRolloutConfig();\n`+(changes[entry]??entries[entry]);
  changes['finance-rollout-config-208.js']=source('backend/shared/finance-rollout-config-208.js');
 }
 const folder=path.join(out,name);fs.mkdirSync(folder,{recursive:true});
 for(const [file,code]of Object.entries(changes)){const dest=path.join(folder,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,code);if(file.endsWith('.js'))cp.execFileSync(process.execPath,['--check',dest],{stdio:'pipe'});}
 fs.writeFileSync(path.join(folder,'changes.json'),JSON.stringify(Object.keys(changes)));
 results.push({name,baseCodeSha256:config.CodeSha256,baseRevisionId:config.RevisionId,handler:config.Handler,runtime:config.Runtime,overlay:folder,changedFiles:Object.keys(changes),scopeFactoryReplacements:notes,financialGeneralActivationRequired:financialFunctions.includes(name)});
}
fs.writeFileSync(path.join(out,'overlays.json'),JSON.stringify({status:'PREPARED_NOT_PUBLISHED',functions:results},null,2)+'\n');console.log(JSON.stringify(results.map(r=>({name:r.name,changedFiles:r.changedFiles.length}))));
