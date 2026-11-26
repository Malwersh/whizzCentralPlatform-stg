#!/usr/bin/env node
'use strict';
// Produces review artifacts only. Never invokes AWS, sends push or changes feature gates.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const esbuild=require('../backend/wallet-service/node_modules/esbuild');
const out=process.argv[2];if(!out||!path.isAbsolute(out))throw Error('Provide an absolute review output directory');
const root=path.resolve(__dirname,'..'),source=path.join(root,'backend/wallet-service/src/codIntegrationRuntime.ts');
const result=esbuild.buildSync({entryPoints:[source],bundle:true,platform:'node',target:'node22',keepNames:true,write:false,logLevel:'silent'});
fs.mkdirSync(out,{recursive:true});const file=path.join(out,'index.js');fs.writeFileSync(file,result.outputFiles[0].contents);
const manifest={schemaVersion:1,stage:'staging',account:'699561669180',region:'us-east-1',functionName:'staging-cod-integration',handler:'index.handler',
 artifact:'index.js',sha256:crypto.createHash('sha256').update(result.outputFiles[0].contents).digest('hex'),activation:'OFF',notificationDelivery:'HELD',scheduleEnabled:false,requiresCoordinatedDeployment:true,
 dispatchResponseMode:'OFF',dispatchResponseNoticeDelivery:'HELD',dispatchResponseQueue:'DISPATCH_RESPONSE_INTEGRATION',
 sourceQueue:{table:'staging-WalletLifecycle',index:'ByDue',partition:'COD_INTEGRATION'},
 effects:['Atomic COD counters and audit; pinned Legacy response acknowledgements and other-offer closure notices; independent mode gates'],
 excludedEffects:['Wallet or ledger mutation','Hold release/capture','Driver dispatch/live-pointer changes','Customer/merchant order status push','Cancellation penalties or compensation payment'],
 requiredDeploymentOrder:['Review current function packages and CloudFormation ownership','Deploy/test Drivers API financial delegation before activation so legacy completion counters cannot also execute','Deploy/test notification worker with live identity/deletion read policy and mode OFF','Deploy financial writer event schema with financial flow gates OFF','Deploy integration worker with mode OFF and schedule disabled','Verify IAM, non-empty synthetic transactions, lifecycle deletion and Gateway/device behavior before coordinated activation'],
 blockers:['No activation approval or complete live verification','Coordinated unpublished acceptance/deletion/retention contract must ship together','Dispatch integration read/write policy on existing Jobs/Offers/Notifications/Lifecycle and notification client integration remain unverified','Incomplete historic counters keep rate unavailable','No automatic backfill of pre-schema events']};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({artifact:file,sha256:manifest.sha256,bytes:result.outputFiles[0].contents.length}));
