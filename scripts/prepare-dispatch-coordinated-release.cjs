'use strict';
// Offline candidate archives, made from pinned live bytes. No AWS mutation.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const ts=require('../backend/wallet-service/node_modules/typescript'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const root=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function nodes(source){const ast=ts.createSourceFile('index.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);if(ast.parseDiagnostics.length)throw Error('INVALID_JAVASCRIPT');const out={};for(const n of ast.statements){const id=ts.isFunctionDeclaration(n)?n.name?.text:ts.isVariableStatement(n)&&n.declarationList.declarations.length===1&&n.declarationList.declarations[0].initializer&&(ts.isArrowFunction(n.declarationList.declarations[0].initializer)||ts.isFunctionExpression(n.declarationList.declarations[0].initializer))?n.declarationList.declarations[0].name.getText(ast):ts.isExpressionStatement(n)&&ts.isBinaryExpression(n.expression)&&['exports.handler','exports.sendWaveOffer'].includes(n.expression.left.getText(ast))?n.expression.left.getText(ast):null;if(id){if(out[id])out[id].duplicates=(out[id].duplicates??1)+1;else out[id]={start:n.getStart(ast),end:n.end,text:n.getText(ast)};}}return out;}
function transplant(live,local,ids){const a=nodes(live),b=nodes(local);const edits=ids.map(id=>{if(!a[id]||!b[id])throw Error('SOURCE_ANCHOR_MISSING:'+id);if(a[id].duplicates||b[id].duplicates)throw Error('DUPLICATE_TARGET_NODE:'+id);return {...a[id],replacement:b[id].text,id};});let s=live;for(const e of edits.sort((x,y)=>y.start-x.start))s=s.slice(0,e.start)+e.replacement+s.slice(e.end);return s;}
function replaceOnce(s,from,to){if(s.split(from).length!==2)throw Error('SOURCE_ANCHOR_COUNT');return s.replace(from,to);}
function orderCatalogEquivalent(a,b){
 const permissions=['orders.read','orders.assign','orders.cancel'];
 function roles(s){const ast=ts.createSourceFile('catalog.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);const d=ast.statements.filter(ts.isVariableStatement).flatMap(n=>[...n.declarationList.declarations]).find(d=>d.name.getText(ast)==='ROLES');if(!d||!ts.isObjectLiteralExpression(d.initializer))throw Error('CATALOG_SCHEMA_CHANGED');const result={};for(const p of d.initializer.properties){if(!ts.isPropertyAssignment(p)||!ts.isArrayLiteralExpression(p.initializer)||p.initializer.elements.some(e=>!ts.isStringLiteral(e)))throw Error('CATALOG_SCHEMA_CHANGED');result[p.name.getText(ast).replace(/^['"]|['"]$/g,'')]=p.initializer.elements.map(e=>e.text);}result.bootstrap_admin=[...new Set(Object.values(result).flat())];return result;}
 const x=roles(a),y=roles(b);if(['allowed','effective'].some(n=>nodes(a)[n]?.text!==nodes(b)[n]?.text))return false;
 return [...new Set([...Object.keys(x),...Object.keys(y)])].every(role=>permissions.every(p=>(x[role]??[]).includes(p)===(y[role]??[]).includes(p)));
}
function codWrapper(){return `\n// Dispatch-only wrapper; the entire published COD module above is preserved.\n{const previous=module.exports;module.exports={...previous,handler:async function(event){if(process.env.DISPATCH_RESPONSE_INTEGRATION_MODE!=='REQUIRED')return previous.handler(event);const cod=await previous.handler(event);const dispatch=await require('./dispatch-response-runtime').handler(event);return {...cod,dispatch};}};}\n`;}
function prepare(audit,out){
 if(!path.isAbsolute(audit)||!path.isAbsolute(out)||fs.existsSync(out))throw Error('NEW_ABSOLUTE_OUTPUT_REQUIRED');const inventory=JSON.parse(fs.readFileSync(path.join(audit,'inventory.json')));if(inventory.account!=='699561669180'||inventory.region!=='us-east-1'||inventory.functions.length!==9)throw Error('PINNED_STAGING_INVENTORY_REQUIRED');
 fs.mkdirSync(out,{mode:0o700});const artifacts=path.join(out,'artifacts');fs.mkdirSync(artifacts,{mode:0o700});
 const save=(n,b)=>{const f=path.join(artifacts,n);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b,{mode:0o600});return f;};
 const bundle=(name,src,target='node20')=>save(name,esbuild.buildSync({entryPoints:[path.join(root,src)],bundle:true,platform:'node',target,keepNames:true,write:false,logLevel:'silent'}).outputFiles[0].contents);
 const coordinator=bundle('dispatch-cycle-runtime.js','backend/wallet-service/src/dispatchCoordinatorRuntime.ts'),bridge=bundle('pinned-legacy-runtime.js','backend/wallet-service/src/dispatchLegacyBridgeRuntime.ts'),response=bundle('dispatch-response-runtime.js','backend/wallet-service/src/dispatchResponseRuntime.ts','node22');
 const manifest={schemaVersion:1,account:inventory.account,region:inventory.region,capturedAt:inventory.capturedAt,preparedAt:new Date().toISOString(),published:false,publicationReady:false,gates:'OFF',financialWritesAuthorized:false,functions:[],blockers:['Fresh effective IAM and deployment gate/config CAS checks','Live staff-decision executor and deletion/retention/notice dependencies must be coordinated','UI/identity/provider/device verification and explicit activation review remain pending']};
 for(const f of inventory.functions){
  const entry=f.handler.slice(0,f.handler.lastIndexOf('.'))+'.js',source=path.join(audit,f.name+'.zip'),file=path.join(audit,'source',f.name,entry),live=fs.readFileSync(file,'utf8');let proposed=live,files={},editedNodes=[];
  const local=n=>fs.readFileSync(path.join(root,n),'utf8');
  if(f.name.startsWith('WaveSystem_')){
   const l=local('lambda/'+f.name+'/index.js');
   if(f.name==='WaveSystem_StartWave'){
    proposed=transplant(live,l,['getDispatchJob']);
    proposed=replaceOnce(proposed,'const dispatchJob = await getDispatchJob(dispatchJobId);','const dispatchJob = await getDispatchJob(dispatchJobId, event.orderId);');
    const begin=l.indexOf("    if (Object.prototype.hasOwnProperty.call(dispatchJob,'dispatchCycle'))"),end=l.indexOf("    if (dispatchJob.status === 'assigned')",begin);if(begin<0||end<begin)throw Error('PINNED_START_BRANCH_REQUIRED');
    proposed=replaceOnce(proposed,"    if (dispatchJob.status === 'assigned')",l.slice(begin,end)+"    if (dispatchJob.status === 'assigned')");editedNodes=['getDispatchJob','handler pinned branch only'];
   }else if(f.name==='WaveSystem_CreateDispatchJob'){
    proposed=transplant(live,l,['exports.handler']);editedNodes=['exports.handler'];
    const guard="  const pinned=await dynamodb.get({TableName:DISPATCH_JOBS_TABLE,Key:{orderId:order.orderId,SK:'METADATA'},ConsistentRead:true}).promise();\n  if(pinned.Item&&Object.prototype.hasOwnProperty.call(pinned.Item,'dispatchCycle'))throw Error('UNIFIED_DISPATCH_NOT_READY');\n";
    const anchor="  if(order.financialSearch?.status==='no_driver_available'&&order.financialSearch?.reviewStatus==='REQUIRED')return {success:true,skipped:true,reason:'FINANCIAL_SEARCH_REVIEW_REQUIRED'};\n";proposed=replaceOnce(proposed,anchor,anchor+guard);
   }else{editedNodes=f.name==='WaveSystem_HandleWaveTimeout'?['exports.handler','getStuckOrders','processExpiredWave','getDispatchJob']:f.name==='WaveSystem_HandleDriverAccept'?['handleRequest']:['handleRequest','triggerNextWave'];proposed=transplant(live,l,editedNodes);}
   files['dispatch-cycle-runtime.js']=coordinator;
  }else if(f.name==='DriversApi-staging'){
   const l=local('../whizzDrivers-stg/backend/lambda_driver_api_v2.js');editedNodes=['createWalletHold','handleRequest','acceptWaveOffer','rejectWaveOffer'];proposed=transplant(live,l,editedNodes);files['pinned-legacy-runtime.js']=bridge;
  }else if(f.name==='staging-wizz-staff-service'){
   const line=local('backend/staff-service/index.js').split('\n').find(s=>s.includes("if(path==='/staff/dispatch-reviews'"));if(!line)throw Error('REVIEW_ROUTE_REQUIRED');const anchor="  if(path==='/staff/slideshow'";proposed=replaceOnce(live,anchor,line+'\n'+anchor);editedNodes=['dispatch review route only'];files['dispatch-reviews.js']=save('staff/dispatch-reviews.js',local('backend/staff-service/dispatch-reviews.js'));
   if(!orderCatalogEquivalent(local('backend/staff-service/catalog.js'),fs.readFileSync(path.join(audit,'source',f.name,'catalog.js'),'utf8')))throw Error('STAFF_CATALOG_DRIFT');
  }else if(f.name.startsWith('wizzcentral-notifications')){
   proposed=transplant(live,local('backend/src/handlers/push-wave-offer.js'),['exports.sendWaveOffer']);editedNodes=['exports.sendWaveOffer'];
   for(const n of ['dispatch-cycle-keys.js','pinned-wave-push.js','pinned-wave-push-handler.js'])files['src/utils/'+n]=save('push/'+n,local('backend/src/utils/'+n));
  }else if(f.name==='staging-cod-integration'){proposed=live+codWrapper();files['dispatch-response-runtime.js']=response;editedNodes=['append dispatch-only wrapper; published COD prefix unchanged'];}
  else throw Error('FUNCTION_NOT_ALLOWLISTED');
  // Each replacement is listed; archive bridge verifies every other entry byte-for-byte.
  const syntaxFile=save(f.name+'/'+entry,proposed);cp.execFileSync(process.execPath,['--check',syntaxFile],{stdio:'pipe'});
  files[entry]=syntaxFile;
  const archive=cp.execFileSync('python3',['-c',"import zipfile,json,sys;names=set(zipfile.ZipFile(sys.argv[1]).namelist());print(json.dumps([n for n in json.loads(sys.argv[2]) if n in names]))",source,JSON.stringify(Object.keys(files))],{encoding:'utf8'}),names=JSON.parse(archive),replacements={},additions={};for(const [n,p]of Object.entries(files))(names.includes(n)?replacements:additions)[n]=p;
  const destination=path.join(out,f.name+'.candidate.zip');const result=JSON.parse(cp.execFileSync('python3',[path.join(root,'scripts/quote-release-archive.py')],{input:JSON.stringify({mode:'overlay',source,expectedCodeSha256:f.codeSha256,destination,replacements,additions}),encoding:'utf8',maxBuffer:1024*1024}));if(result.error)throw Error(result.error);
  fs.writeFileSync(path.join(out,f.name+'.rollback.zip'),fs.readFileSync(source),{mode:0o600});
  const info={name:f.name,handler:f.handler,runtime:f.runtime,baseCodeSha256:f.codeSha256,baseRevisionId:f.revisionId,baseEnvironmentDigest:f.environmentDigest,candidateCodeSha256:result.codeSha256,entrySha256:hash(proposed),editedNodes,preservedFiles:result.preservedFiles,replacedFiles:result.replacedFiles,addedFiles:result.addedFiles,gatePlan:{DISPATCH_CYCLE_MODE:'OFF',DISPATCH_LEGACY_HOST_MODE:'OFF',DISPATCH_RESTART_START_MODE:'OFF',DISPATCH_REVIEW_MODE:'OFF',DISPATCH_REVIEW_EXECUTION_MODE:'OFF',PINNED_LEGACY_PUSH_MODE:'OFF',DISPATCH_RESPONSE_INTEGRATION_MODE:'OFF'}};
  manifest.functions.push(info);fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 }
 return manifest;
}
if(require.main===module){try{const m=prepare(process.argv[2],process.argv[3]);console.log(JSON.stringify({prepared:m.functions.map(f=>({name:f.name,changed:f.replacedFiles,added:f.addedFiles,preserved:f.preservedFiles})),published:false}));}catch(e){console.error('DISPATCH_PREPARE_FAILED:',e.message);process.exitCode=1;}}
module.exports={nodes,transplant,replaceOnce,codWrapper,orderCatalogEquivalent,prepare};
