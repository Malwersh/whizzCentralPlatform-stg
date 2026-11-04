'use strict';
// Offline overlays against reviewed live hashes. No AWS client or publisher.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const ts=require('../backend/wallet-service/node_modules/typescript');
const esbuild=require('../backend/wallet-service/node_modules/esbuild');
const {nodes,transplant,replaceOnce}=require('./prepare-dispatch-coordinated-release.cjs');
const {FUNCTIONS}=require('./check-finance-rollout-deployment.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const PRIVACY=['WizzUser-CancelOrder-staging','WizzUser-GetGuestOrders-staging','WizzUser-GetOrder-staging','WizzUser-GetUserOrders-staging','WizzUser-MerchantOrderStatusUpdate-staging','WizzUser-SearchOrderByNumber-staging','WizzUser-UpdateOrderStatus-staging','order-receiver-merchant-orders-staging-v1'];
function financialPatch(live,source){
 const boundary='// backend/wallet-service/src/driverFinancialRuntime.ts';
 if(!live.includes(boundary))throw Error('FINANCIAL_RUNTIME_BOUNDARY_CHANGED');
 const offset=live.lastIndexOf(boundary);const tail=live.slice(offset+boundary.length);
 const ast=ts.createSourceFile('runtime.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 // Reuse the existing SDK bindings and financial factories in the published module.
 // Only the entry adapter is transpiled; no money implementation is bundled twice.
 const sdk={};
 for(const name of ['DynamoDBClient','DynamoDBDocumentClient','CognitoIdentityProviderClient','SecretsManagerClient']){
  const matches=[...tail.matchAll(new RegExp('([A-Za-z_$][\\w$]*)\\.'+name+'\\b','g'))].map(m=>m[1]);
  if(new Set(matches).size!==1)throw Error('FINANCIAL_SDK_BINDING_CHANGED:'+name);
  sdk[name]=matches[0]+'.'+name;
 }
 let text=source;
 for(const n of [...ast.statements].reverse())if(ts.isImportDeclaration(n))text=text.slice(0,n.getStart(ast))+text.slice(n.end);
 text=text.replace(/\bexport\s+(?=async function|function)/g,'');
 let js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 for(const [name,value]of Object.entries(sdk))js=js.replace(new RegExp('\\b'+name+'\\b','g'),value);
 js=js.replace(/\bcreateFinanceRollout\(/g,"require('./finance-rollout').createFinanceRollout(");
 const ids=Object.keys(nodes(js));
 if(ids.length!==11||ids.some(id=>!nodes(tail)[id]))throw Error('FINANCIAL_RUNTIME_FUNCTION_SET_CHANGED');
 const result=transplant(live,js,ids);
 // Entire prefix includes all existing hold, completion, return, ledger factories.
 if(result.slice(0,offset)!==live.slice(0,offset))throw Error('PUBLISHED_MONEY_CODE_CHANGED');
 return {source:result,proof:{preservedMoneyPrefixSha256:sha(live.slice(0,offset)),adapterFunctions:ids}};
}
function codPatch(live){
 const a=nodes(live).handler;if(!a)throw Error('COD_HANDLER_MISSING');
 const original=a.text;
 const re=/const db = (import_lib_dynamodb\d*\.DynamoDBDocumentClient\.from\(new import_client_dynamodb\d*\.DynamoDBClient\(\{ region: "us-east-1" \}\), \{ marshallOptions: \{ removeUndefinedValues: true \} \}\));/;
 if(!re.test(original))throw Error('COD_DB_ANCHOR_CHANGED');
 const modified=original.replace(re,(_,expr)=>`const db = require('./finance-rollout').createFinanceRollout({db:${expr}}).db;`);
 return {source:replaceOnce(live,original,modified),proof:{preservedOutsideAdapterSha256:sha(live.slice(0,a.start)+live.slice(a.end))}};
}
function prepare(audit,out){
 if(!path.isAbsolute(audit)||!path.isAbsolute(out)||fs.existsSync(out))throw Error('NEW_ABSOLUTE_DIRECTORY_REQUIRED');
 const inv=JSON.parse(fs.readFileSync(path.join(audit,'inventory.json')));
 const expected=[...FUNCTIONS,...PRIVACY].sort();
 if(inv.account!=='699561669180'||inv.region!=='us-east-1'||JSON.stringify(inv.functions.map(f=>f.name).sort())!==JSON.stringify(expected))throw Error('EXACT_COORDINATED_INVENTORY_REQUIRED');
 const baseline=JSON.parse(fs.readFileSync(path.join(root,'docs/finance-transition-live-audit-51.json')));
 const known=Object.fromEntries(baseline.functions.map(f=>[f.name,f.codeSha256]));
 for(const f of inv.functions)if(known[f.name]!==f.codeSha256)throw Error('UNREVIEWED_LIVE_DRIFT:'+f.name);
 for(const script of ['sync-finance-rollout-runtime.cjs','sync-delivery-quote-order-runtime.cjs','build-delivery-quote-runtime.cjs'])cp.execFileSync(process.execPath,[path.join(__dirname,script),'--check'],{stdio:'pipe'});
 fs.mkdirSync(out,{mode:0o700});
 const save=(n,b)=>{const p=path.join(out,'artifacts',n);fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,b,{mode:0o600});return p;};
 const local=p=>fs.readFileSync(path.resolve(root,p),'utf8');
 const bundle=(name,src)=>save(name,esbuild.buildSync({entryPoints:[path.resolve(root,src)],bundle:true,platform:'node',target:'node20',keepNames:true,write:false,logLevel:'silent'}).outputFiles[0].contents);
 const runtimes={
  'dispatch-cycle-runtime.js':bundle('dispatch-cycle-runtime.js','backend/wallet-service/src/dispatchCoordinatorRuntime.ts'),
  'pinned-legacy-runtime.js':bundle('pinned-legacy-runtime.js','backend/wallet-service/src/dispatchLegacyBridgeRuntime.ts'),
  'dispatch-response-runtime.js':bundle('dispatch-response-runtime.js','backend/wallet-service/src/dispatchResponseRuntime.ts'),
  'dispatch-review-host-runtime.js':bundle('dispatch-review-host-runtime.js','backend/wallet-service/src/dispatchReviewHostRuntime.ts'),
 };
 // Financial Lambdas embed their SDK and have no node_modules; bundle the guard dependency.
 const guard=bundle('finance-rollout.js','backend/wallet-service/src/financeRollout.ts');
 const router=bundle('commercial-order-router.js','../wizzuser-stg/backend/src/functions/create-order/commercial-order-router.js');
 const commercial=bundle('commercial-runtime.js','../wizzuser-stg/backend/src/functions/create-order/index.js');
 const quote=bundle('quote-index.js','../wizzuser-stg/backend/src/functions/delivery-quotes/index.js');
 const result={schemaVersion:1,part:54,account:inv.account,region:inv.region,capturedAt:inv.capturedAt,preparedAt:new Date().toISOString(),published:false,activated:false,publicationReady:false,environmentChanges:false,IAMChanges:false,functions:[]};
 for(const f of inv.functions){
  const source=path.join(audit,f.name+'.zip');
  const list=JSON.parse(cp.execFileSync('python3',['-c','import zipfile,json,sys;print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))',source],{encoding:'utf8',maxBuffer:10000000}));
  const read=n=>cp.execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',source,n],{encoding:'utf8',maxBuffer:20000000});
  const files={},proofs=[];const put=(n,text)=>files[n]=save(f.name+'/'+n,text);
  const entry=f.handler.slice(0,f.handler.lastIndexOf('.'))+'.js';
  if(f.name.startsWith('WaveSystem_')){
   files['dispatch-cycle-runtime.js']=runtimes['dispatch-cycle-runtime.js'];
   if(f.name==='WaveSystem_CreateDispatchJob')put(entry,transplant(read(entry),local('lambda/'+f.name+'/index.js'),['exports.handler']));
   if(list.includes('financial-runtime.js')){const p=financialPatch(read('financial-runtime.js'),local('backend/wallet-service/src/driverFinancialRuntime.ts'));put('financial-runtime.js',p.source);proofs.push(p.proof);files['finance-rollout.js']=guard;}
  }else if(f.name==='DriversApi-staging'){
   files['pinned-legacy-runtime.js']=runtimes['pinned-legacy-runtime.js'];
   put(entry,replaceOnce(read(entry),"new Set(['financialSnapshot','commercialPricing','financialAcceptance'])","new Set(['financeRollout','financialSnapshot','commercialPricing','financialAcceptance'])"));
  }else if(f.name==='staging-driver-financial-accept'){
   const p=financialPatch(read(entry),local('backend/wallet-service/src/driverFinancialRuntime.ts'));put(entry,p.source);proofs.push(p.proof);files['finance-rollout.js']=guard;
  }else if(f.name==='staging-cod-integration'){
   const p=codPatch(read(entry));put(entry,p.source);proofs.push(p.proof);files['finance-rollout.js']=guard;
   for(const n of ['dispatch-response-runtime.js','dispatch-review-host-runtime.js'])files[n]=runtimes[n];
  }else if(f.name==='WizzUser-DeliveryQuotes-staging')files[entry]=quote;
  else if(f.name==='WizzUser-CreateOrder-staging'){
   files['functions/create-order/commercial-runtime.js']=commercial;
   files['functions/create-order/commercial-order-router.js']=router;
   // The live legacy entry retains offer/audience/attribution and discount behavior.
   proofs.push({preservedLegacyEntrySha256:sha(read(entry))});
  }else if(f.name==='staging-wizz-staff-service'){
   const line=s=>s.split('\n').find(l=>l.includes("if(path==='/staff/dispatch-reviews'"));
   put(entry,replaceOnce(read(entry),line(read(entry)),line(local('backend/staff-service/index.js'))));
   put('dispatch-reviews.js',local('backend/staff-service/dispatch-reviews.js'));files['finance-rollout.js']=guard;
  }else if(f.name==='staging-wizz-wallet-notification-worker'){
   put(entry,local('backend/wallet-service/notification-worker/index.js'));files['finance-rollout.js']=guard;
  }else if(f.name==='wizzcentral-notifications-staging-pushSendWaveOffer'){
   put('src/utils/pinned-wave-push-handler.js',local('backend/src/utils/pinned-wave-push-handler.js'));files['src/utils/finance-rollout.js']=guard;
  }else if(PRIVACY.includes(f.name)){
   if(f.name.startsWith('WizzUser-')){
    const file='functions/create-order/commercial-order-router.js';
    if(list.includes(file)){const live=read(file);put(file,replaceOnce(live,'const { financialSnapshot,','const { financeRollout, financialSnapshot,'));}
    else if(f.name==='WizzUser-MerchantOrderStatusUpdate-staging'){
     const n=nodes(read(entry))['exports.handler'];if(!n||!n.text.includes('orderId: updatedOrder.orderId')||!n.text.includes('estimatedDeliveryTime: updatedOrder.estimatedDeliveryTime'))throw Error('PUBLIC_STATUS_PROJECTION_CHANGED');
     proofs.push({alreadyExplicitPublicResponse:true,unchangedEntrySha256:sha(read(entry))});
    }else throw Error('CUSTOMER_PRIVACY_HELPER_MISSING');
   }else{
    const live=read(entry), modified=live.replace(/\{\s*financialSnapshot,/, '{financeRollout, financialSnapshot,');
    if(modified===live)throw Error('MERCHANT_PRIVACY_ANCHOR_CHANGED');put(entry,modified);
   }
  }else throw Error('UNKNOWN_TARGET');
  for(const p of Object.values(files))cp.execFileSync(process.execPath,['--check',p],{stdio:'pipe'});
  const replacements={},additions={};for(const[n,p]of Object.entries(files))(list.includes(n)?replacements:additions)[n]=p;
  const destination=path.join(out,f.name+'.candidate.zip');
  const p=JSON.parse(cp.execFileSync('python3',[path.join(__dirname,'quote-release-archive.py')],{input:JSON.stringify({mode:'overlay',source,destination,expectedCodeSha256:f.codeSha256,replacements,additions}),encoding:'utf8',maxBuffer:2000000}));if(p.error)throw Error(p.error);
  const rollback=path.join(out,f.name+'.rollback.zip');fs.copyFileSync(source,rollback);fs.chmodSync(rollback,0o600);fs.chmodSync(destination,0o600);
  result.functions.push({...f,candidateCodeSha256:p.codeSha256,preservedFiles:p.preservedFiles,replacedFiles:p.replacedFiles,addedFiles:p.addedFiles,proofs});
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
 }
 return result;
}
module.exports={financialPatch,codPatch,prepare,PRIVACY};
if(require.main===module){try{const r=prepare(process.argv[2],process.argv[3]);console.log(JSON.stringify({prepared:r.functions.length,published:false,activated:false}));}catch(e){console.error(e.message);process.exitCode=1;}}
