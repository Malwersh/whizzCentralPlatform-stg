#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const esbuild=require('../backend/wallet-service/node_modules/esbuild');
const root=path.resolve(__dirname,'..');
const out=process.argv[2];
if(!out||!path.isAbsolute(out))throw Error('Provide an absolute review output directory');
// Build only. Never upload or alter a live package/IAM/environment here.
const result=esbuild.buildSync({entryPoints:[path.join(root,'backend/wallet-service/src/driverFinancialRuntime.ts')],
 bundle:true,platform:'node',target:'node22',keepNames:true,write:false,logLevel:'silent'});
fs.mkdirSync(out,{recursive:true});
const file=path.join(out,'financial-runtime.js');fs.writeFileSync(file,result.outputFiles[0].contents);
const manifest={schemaVersion:1,stage:'staging',file:'financial-runtime.js',sha256:crypto.createHash('sha256').update(result.outputFiles[0].contents).digest('hex'),
 destinations:['lambda/WaveSystem_StartWave/financial-runtime.js','lambda/WaveSystem_HandleWaveTimeout/financial-runtime.js',
  'staging-driver-financial-accept/index.js'],activation:'OFF',completionActivation:'OFF',returnsActivation:'OFF',assignmentsActivation:'OFF',requiresCoordinatedDeployment:true,
 blockers:['Live package comparison and IAM/Gateway verification','Policy-backed compensation, outbox and retention integration','Human device return/cancellation UX, adjudication and Gateway verification','Completion outbox consumer and retention integration','Deletion and retention integration','Real Staging synthetic acceptance test']};
const completionReview={schemaVersion:1,stage:'staging',activation:'OFF',notApplied:true,
 functionName:'staging-driver-financial-accept',additionalEnvironment:{FINANCIAL_COD_COMPLETION_MODE:'OFF',FINANCIAL_COD_RETURNS_MODE:'OFF',FINANCIAL_COD_ASSIGNMENTS_MODE:'OFF',FINANCIAL_REASSIGNMENT_WINDOW_SECONDS:'UNCONFIGURED'},
 scope:'Review delta to acceptance role; not a deployable policy or approval to apply it',
 permissions:[
  {table:'staging-Wallets',actions:['GetItem','ConditionCheckItem','UpdateItem'],leadingKeys:['WALLET#DRIVER#*','WALLET#MERCHANT#*','WALLET#PLATFORM']},
  {table:'staging-LedgerEntries',actions:['PutItem'],leadingKeys:['WALLET#DRIVER#*','WALLET#MERCHANT#*','WALLET#PLATFORM']},
  {table:'staging-Holds',actions:['GetItem','ConditionCheckItem','PutItem','UpdateItem'],keys:['HOLD','PROMOTION_FUNDING','FINANCIAL_OUTCOME','MERCHANT_PAYABLE','RETURN#attempt','ASSIGNMENT_RELEASE#attempt']},
  {table:'staging-WalletLifecycle',actions:['GetItem','ConditionCheckItem','PutItem','UpdateItem']},
  {table:'staging-AuditLog',actions:['PutItem']},
  {table:'WizzOrders',actions:['GetItem','ConditionCheckItem','UpdateItem']},
  {table:'WizzDispatchJobs_staging',actions:['GetItem','ConditionCheckItem','UpdateItem']},
  {table:'WizzDriverLiveState_staging',actions:['GetItem','ConditionCheckItem','UpdateItem']},
  {table:'WaveOffers_staging',actions:['GetItem','ConditionCheckItem']},
  {table:'WhizzDrivers_staging',actions:['GetItem','ConditionCheckItem']},
  {table:'WhizzMerchants_Businesses',actions:['GetItem','ConditionCheckItem']},
  {table:'staging-AccountDeletion',actions:['ConditionCheckItem']}],
 constraints:['Issuer/acceptance now require GetItem/ConditionCheckItem on assignment release archives in staging-Holds',
 'Timeout worker must preserve and resume financialRedispatch intents; worker frequency must be verified',
 'Return owner routes require AdminGetUser on merchant pool us-east-1_gtCR3ndzT in addition to driver pool',
 'Merchant auth invokes only the fixed writer ARN; no wallet/ledger mutation grant',
 'us-east-1 / account 699561669180 only','No DeleteItem, wallet creation, payout or Cognito changes',
 'Drivers API retains InvokeFunction only','Review deployed policy and CloudFormation ownership before applying any delta',
 'Hold sort-key list describes runtime access; do not assume it is an IAM sort-key restriction']};
fs.writeFileSync(path.join(out,'cod-completion-review.json'),JSON.stringify(completionReview,null,2)+'\n');
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({artifact:file,sha256:manifest.sha256,bytes:result.outputFiles[0].contents.length}));
