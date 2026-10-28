'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),p=path.join(root,'backend/.tmp/admin-dispatch-retry-298');
const esbuild=require('../backend/wallet-service/node_modules/esbuild'),ts=require('../backend/wallet-service/node_modules/typescript');
const modules={
 dispatchCycle:['createDispatchCycle','validateDispatchCycle'],
 dispatchCoordinator:['createStagingDispatchCoordinator'],
 financeDispatchRecovery:['financialRecoveryProof'],
 dispatchCandidates:['createStagingDispatchCandidates'],
 dispatchWaveExecutor:['createStagingDispatchWaveExecutor','createStagingPinnedFinancialRunner'],
 dispatchRestartStart:['createStagingDispatchRestartStart'],
 dispatchReviewExecutor:['createStagingDispatchReviewExecutor'],
 dispatchReviewHost:['createStagingDispatchReviewHost'],
 driverFinancialWave:['createStagingDriverFinancialWave','expireFinancialWave'],
 driverOfferStore:['createStagingDriverOfferStore'],
 driverOfferAcceptance:['createStagingDriverOfferAcceptance'],
 financialOfferDelivery:['createStagingFinancialOfferDelivery','readStagingFinancialOfferDelivery'],
 financialSearch:['createStagingFinancialSearch'],
 codFlowContext:['createCodFlowContext'],
 codReassignment:['createStagingCodReassignment'],
 codCompletion:['createStagingCodCompletion'],
 fullCashCompletion:['createFullCashCompletion'],
 codIntegration:['createStagingCodIntegration'],
 cancellationCompensation:['createCancellationCompensation'],
 returnCustody:['createReturnCustodyReconciler'],
 driverQualityReview:['createDriverQualityReview'],
 driverQualityAppeal:['createDriverQualityAppeal'],
 driverTimingReview:['createDriverTimingReview'],
 merchantSettlementPreview:['readMerchantAccrualEvidence'],
 merchantSettlementBatch:['createMerchantSettlementBatchService'],
};
// Use actual exported names only; fail closed if the source shape changes.
let entry='';const targets=new Set(['dispatchWaveSK','dispatchOfferSK']);
for(const [mod,names]of Object.entries(modules)){
 const s=fs.readFileSync(path.join(root,'backend/wallet-service/src',mod+'.ts'),'utf8');
 for(const name of names){if(!new RegExp('export (async )?function '+name+'\\(').test(s))continue;targets.add(name);entry+=`export {${name}} from '../../../wallet-service/src/${mod}';\n`;}
}
entry+="const {dispatchWaveSK,dispatchOfferSK}=require('../../../src/utils/dispatch-cycle-keys'); export {dispatchWaveSK,dispatchOfferSK};\n";
// Entry lives inside backend/.tmp/admin-dispatch-retry-298, so source imports are backend-relative.
entry=entry.replaceAll("../../../wallet-service/","../../wallet-service/").replaceAll("../../../src/","../../src/");
fs.writeFileSync(path.join(p,'entry.ts'),entry);
if(process.argv[2]){
 const file=process.argv[2],relative=process.argv[3]||path.basename(file),s=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits=[];
 const delegate='./'+path.posix.relative(path.posix.dirname(relative),'admin-retry-runtime-298.js');
 const functions=[];
 function collect(n){if(ts.isFunctionDeclaration(n)&&n.name&&n.body)functions.push(n);ts.forEachChild(n,collect);}collect(ast);
 const ancestor=(scope,node)=>{for(let x=node;x;x=x.parent)if(x===scope)return true;return false;};
 function sdkFor(n){
  let body=n.body.getText(ast),match=body.match(/new ([$\w]+)\.(?:Get|Query|Scan|TransactWrite)Command\(/);
  if(match)return match[1];
  const calls=[...body.matchAll(/\b(strongGet[0-9]*)\(/g)].map(m=>m[1]);
  for(const name of calls){const helper=functions.filter(f=>f.name.text===name&&ancestor(f.parent,n)).sort((a,b)=>b.pos-a.pos)[0];if(helper){match=helper.body.getText(ast).match(/new ([$\w]+)\.GetCommand\(/);if(match)return match[1];}}
  return 'require("@aws-sdk/lib-dynamodb")';
 }
 function visit(n){
  if(ts.isFunctionDeclaration(n)&&n.name&&n.body){
   const name=n.name.text,base=[...targets].find(t=>name===t||new RegExp('^'+t+'[0-9]+$').test(name));
   if(base){const sdk=sdkFor(n);const pure=['createDispatchCycle','validateDispatchCycle','dispatchWaveSK','dispatchOfferSK'].includes(base);
 const body=pure?`{ return require(${JSON.stringify(delegate)}).${base}(...arguments); }`:
 `{ const args=[...arguments], first=args[0], original=first?.db??(typeof first?.send==='function'?first:null); if(original){const sdk=${sdk};const bridge={send(command){const type=command?.constructor?.name?.replace(/\\d+$/,'');if(!['GetCommand','QueryCommand','ScanCommand','TransactWriteCommand'].includes(type)||typeof sdk[type]!=='function')throw Error('ADMIN_RETRY_DDB_COMMAND_INVALID');return original.send(command instanceof sdk[type]?command:new sdk[type](command.input));}};args[0]=first.db?{...first,db:bridge}:bridge;} if(first?.cognito&&typeof first.cognito.send==='function'){const sdk=require('@aws-sdk/client-cognito-identity-provider'),client=first.cognito;args[0]={...args[0],cognito:{send(command){const type=command?.constructor?.name?.replace(/\\d+$/,'');if(!['AdminGetUserCommand','GetUserCommand','AdminListGroupsForUserCommand'].includes(type)||typeof sdk[type]!=='function')throw Error('ADMIN_RETRY_COGNITO_COMMAND_INVALID');return client.send(command instanceof sdk[type]?command:new sdk[type](command.input));}}};} return require(${JSON.stringify(delegate)}).${base}(...args); }`;
 edits.push([n.body.getStart(ast),n.body.end,body,name]);return;}
  }ts.forEachChild(n,visit);
 }visit(ast);
 let out=s;for(const [a,b,body]of edits.sort((a,b)=>b[0]-a[0]))out=out.slice(0,a)+body+out.slice(b);
 fs.writeFileSync(file+'.patched',out);console.log(JSON.stringify({relative,functions:edits.map(e=>e[3])}));
}
