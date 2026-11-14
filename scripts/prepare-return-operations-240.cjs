'use strict';
const fs=require('fs'),assert=require('assert/strict'),ts=require('../backend/wallet-service/node_modules/typescript'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const p='backend/.tmp/order-exceptions-work/return-240';
function fn(s,name){const t=ts.createSourceFile('entry.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),a=t.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.equal(a.length,1,name);return {n:a[0],t};}
let financial=fs.readFileSync(p+'/financial-base.js','utf8'),canonical=fs.readFileSync('backend/wallet-service/dist/driverFinancialRuntime.js','utf8');
for(const name of ['financialCodReturn','financialAcceptanceHandler']){
 const {n,t}=fn(canonical,name);let body=n.getText(t);
 for(const [mod,symbol]of [['financialIdentity','authenticateFinancialIdentity'],['codReturn','createStagingCodReturn'],['returnDisposition','createReturnDisposition'],['returnOperations','createReturnOperations'],['returnOperations','createReturnRoadRouter']])body=body.replaceAll('(0, '+mod+'_1.'+symbol+')','require("./order-exception-runtime-229.js").'+symbol);
 body=body.replaceAll('(0, financialPushValidation_1.createStagingFinancialPushValidation)','createStagingFinancialPushValidation');assert(!/\b\w+_1\./.test(body),'UNBOUND '+name);
 const old=fn(financial,name);financial=financial.slice(0,old.n.getStart(old.t))+body+financial.slice(old.n.end);
}
fs.writeFileSync(p+'/financial-candidate.js',financial);
let driver=fs.readFileSync('../whizzDrivers-stg/backend/lambda_driver_api_v2.js','utf8'),before=fs.readFileSync(p+'/driver-base.js','utf8');const prefix="'use strict';\nrequire(\"./finance-rollout-config-208.js\").restoreFinanceRolloutConfig();\n";assert(before.startsWith(prefix));fs.writeFileSync(p+'/driver-candidate.js',prefix+driver);
let staff=fs.readFileSync(p+'/staff-base.js','utf8');const marker='    if (path === "/staff/order-exceptions"';assert.equal(staff.split(marker).length,2);staff=staff.replace(marker,'    if(path.startsWith("/staff/settings/return-operations"))return response(200,await require("../../return-operations-settings.js").route({settingsRoute:settingsRoutes.route,db,table,employee,guard,audit,enrolled,recent,claims,allowed},actor,method,path,input));\n'+marker);fs.writeFileSync(p+'/staff-candidate.js',staff);
const merchant=esbuild.buildSync({entryPoints:['../whizzMerchants-stg/backend/functions/auth/order_returns.js'],platform:'node',target:'node20',bundle:true,external:['@aws-sdk/lib-dynamodb'],write:false}).outputFiles[0].contents;fs.writeFileSync(p+'/merchant-candidate.js',merchant);
fs.copyFileSync('backend/shared/exception-case-sla-232.js',p+'/sla-candidate.js');
console.log('Prepared five bounded service updates; existing configuration and unrelated archive entries preserved.');
