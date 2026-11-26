#!/usr/bin/env node
'use strict';
// Offline preparation only. Every existing ZIP entry outside the explicit file list is preserved byte-for-byte.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {readTemplate}=require('./prepare-delivery-quote-release.cjs');
const root=path.resolve(__dirname,'..');
function bridge(request){return JSON.parse(cp.execFileSync('python3',[path.join(__dirname,'quote-release-archive.py')],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:12*1024*1024}));}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function prepare(audit,out){
 if(!path.isAbsolute(audit)||!path.isAbsolute(out)||fs.existsSync(out))throw Error('NEW_ABSOLUTE_OUTPUT_REQUIRED');
 const evidence=JSON.parse(fs.readFileSync(path.join(audit,'inventory.json')));if(evidence.account!=='699561669180'||evidence.region!=='us-east-1')throw Error('STAGING_EVIDENCE_REQUIRED');
 const live=new Map(evidence.functions.map(f=>[f.name,f]));for(const n of ['staging-driver-financial-accept','staging-cod-integration'])if(live.get(n)?.exists!==false)throw Error('NEW_RESOURCE_ALREADY_EXISTS');
 fs.mkdirSync(out,{recursive:true,mode:0o700});const save=(name,data)=>{const f=path.join(out,name);fs.writeFileSync(f,data,{mode:0o600});return f;};
 const defs=[
 ['DriversApi-staging',root+'/../whizzDrivers-stg/backend', ['lambda_driver_api_v2.js'],['financial-accept-client.js','financial-order-view.js']],
 ['WaveSystem_StartWave',root+'/lambda/WaveSystem_StartWave',['index.js'],['driver-selection.js','legacy-offer-contract.js']],
 ['WaveSystem_HandleWaveTimeout',root+'/lambda/WaveSystem_HandleWaveTimeout',['index.js'],[]],
 ['WaveSystem_HandleDriverAccept',root+'/lambda/WaveSystem_HandleDriverAccept',['index.js'],[]],
 ['staging-wizz-wallet-notification-worker',root+'/backend/wallet-service/notification-worker',['index.js'],[]],
 ['staging-wizz-wallet-service',root+'/backend/wallet-service',['dist/holdService.js','dist/walletLifecycle.js'],[]],
 ['staging-wizz-wallet-lifecycle',root+'/backend/wallet-service',['dist/holdService.js','dist/walletLifecycle.js'],[]],
 ['OrderService-staging',root+'/backend/order-service',['dist/orderCancellationService.js','dist/driverUnassignmentService.js'],[]],
 ['staging-account-deletion-requests',root+'/backend/account-deletion',['customer-evidence.js','driver-evidence.js','merchant-evidence.js'],['cod-retention.js']],
 ['staging-account-deletion-worker',root+'/backend/account-deletion',['worker.js','customer-cleanup.js','driver-cleanup.js','merchant-cleanup.js'],['cod-retention.js','customer-delivery-quotes.js']],
 ['staging-account-deletion-financial-expiry',root+'/backend/account-deletion',['financial-purge.js'],['cod-retention.js']],
 ['order-receiver-regional-staging-unified-auth-v4-sam',root+'/../whizzMerchants-stg/backend/functions/auth',['unified_auth_handler.js','person_onboarding.js'],['order_returns.js']]
 ];
 const results=[];
 for(const [name,dir,replacements,additions]of defs){
  const info=live.get(name);if(!info?.exists||!info.tags?.['aws:cloudformation:stack-name'])throw Error('CFN_OWNERSHIP_REQUIRED:'+name);
  const files={};for(const file of [...replacements,...additions]){
   let data=fs.readFileSync(path.join(dir,file));
   if(name==='order-receiver-regional-staging-unified-auth-v4-sam'&&file==='unified_auth_handler.js')data=Buffer.from(data.toString().replaceAll("require('../shared/merchant-lifecycle')","require('./shared/merchant-lifecycle')"));
   if(file==='order_returns.js'){
    data=require('../backend/wallet-service/node_modules/esbuild').buildSync({entryPoints:[path.join(dir,file)],bundle:true,platform:'node',target:'node22',external:['@aws-sdk/lib-dynamodb'],write:false,logLevel:'silent'}).outputFiles[0].contents;
   }
   const output=save(name+'.'+file.replaceAll('/','_'),data);cp.execFileSync(process.execPath,['--check',output]);files[file]=output;
  }
  if(name.startsWith('WaveSystem_')&&name!=='WaveSystem_HandleDriverAccept')files['financial-runtime.js']='/private/tmp/driver-financial-release25/financial-runtime.js';
  const replacementMap=Object.fromEntries(Object.entries(files).filter(([n])=>info.files[n]));const additionMap=Object.fromEntries(Object.entries(files).filter(([n])=>!info.files[n]));
  // Known entry list only; reject unexpected source files or symlinks through the archive bridge.
  const zip=bridge({mode:'patch',source:path.join(audit,name+'.zip'),destination:path.join(out,name+'.candidate.zip'),expectedCodeSha256:info.codeSha256,replacements:replacementMap,additions:additionMap});
  results.push({name,stack:info.tags['aws:cloudformation:stack-name'],logicalId:info.tags['aws:cloudformation:logical-id'],baseRevisionId:info.revisionId,baseCodeSha256:info.codeSha256,handler:info.handler,role:info.role,zip,changedFiles:Object.keys(replacementMap),addedFiles:Object.keys(additionMap)});
 }
 for(const [name,file]of [['staging-driver-financial-accept','/private/tmp/driver-financial-release25/financial-runtime.js'],['staging-cod-integration','/private/tmp/cod-integration-release25/index.js']]){
  const zip=bridge({mode:'new',destination:path.join(out,name+'.candidate.zip'),additions:{'index.js':file}});results.push({name,newFunction:true,stack:'staging-wizz-wallet-service',logicalId:name==='staging-driver-financial-accept'?'DriverFinancialAcceptanceFunction':'CodIntegrationWorker',zip});
 }
 const wallet=readTemplate(path.join(root,'backend/wallet-service/cod-lifecycle.staging.json'));
 save('new-functions.json',JSON.stringify(Object.fromEntries(['DriverFinancialAcceptanceFunction','CodIntegrationWorker'].map(k=>[k,wallet.Resources[k]])),null,2));
 const manifest={schemaVersion:1,account:'699561669180',region:'us-east-1',activation:'OFF',notificationDelivery:'HELD',scheduleEnabled:false,deployable:false,requiresChangeSetReview:true,sourceEvidenceSha256:sha(fs.readFileSync(path.join(audit,'inventory.json'))),functions:results};
 save('manifest.json',JSON.stringify(manifest,null,2)+'\n');return manifest;
}
module.exports={prepare};
if(require.main===module){const r=prepare(process.argv[2],process.argv[3]);console.log(JSON.stringify({functions:r.functions.length,activation:r.activation,output:process.argv[3]}));}
