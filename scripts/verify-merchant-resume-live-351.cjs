'use strict';
// Executes the extracted, read-only downloaded worker function against an in-memory
// fixture. Imported DynamoDB/transaction helpers are the local tested implementations.
const fs=require('fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const ts=require('../backend/wallet-service/node_modules/typescript');
const {setup}=require('../backend/wallet-service/test/helpers/driver-financial-fixture.cjs');
const {strongGet,exactCheck}=require('../backend/wallet-service/dist/driverFinancialTransaction');
const {setFinancialFields}=require('../backend/wallet-service/dist/financialRelease');
const sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const source=fs.readFileSync(process.argv[2],'utf8'),ast=ts.createSourceFile('worker.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='resumeMerchantPause');assert(fn,'deployed function missing');
const ctx={strongGet,exactCheck,setFinancialFields,import_lib_dynamodb5:sdk,__name:x=>x};
vm.createContext(ctx);vm.runInContext(fn.getText(ast)+';this.run=resumeMerchantPause;',ctx);
function fixture(){const f=setup(),at=new Date(f.time).toISOString(),row={operationId:'MERCHANT_RESUME#branch1#pause1',kind:'MERCHANT_RESUME',branchId:'branch1',ownerId:'owner1',pauseId:'pause1',pausedAt:new Date(f.time-900000).toISOString(),status:'PENDING',nextAttemptAt:Math.floor(f.time/1000)};f.put('staging-WalletLifecycle',row);const b=f.get('WhizzMerchants_Businesses',{businessId:'branch1'});Object.assign(b,{isActive:true,onboardingSchemaVersion:1,onboardingComplete:true,acceptingOrders:false,orderPauseId:'pause1',ordersPausedUntil:at,lastStatusUpdate:row.pausedAt});return {f,b,row,at};}
(async()=>{
 let count=0;
 let x=fixture();assert.equal((await ctx.run(x.f.db,x.row,x.at)).resumed,true);assert.equal(x.f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).acceptingOrders,true);count++;
 for(const patch of [{orderPauseId:'replacement'},{lastStatusUpdate:'manual-change'},{platformSuspended:true},{ordersBlocked:true},{ownerId:'other'},{deletionRequestId:'closing'},{isActive:false},{onboardingComplete:false}]){x=fixture();Object.assign(x.b,patch);assert.equal((await ctx.run(x.f.db,x.row,x.at)).resumed,false);assert.equal(x.b.acceptingOrders,false);count++;}
 x=fixture();x.row.nextAttemptAt+=60;assert.equal((await ctx.run(x.f.db,x.row,x.at)).deferred,true);assert.equal(x.b.acceptingOrders,false);count++;
 x=fixture();x.f.beforeCommit=()=>{x.b.lastStatusUpdate='concurrent-manual-close';};await assert.rejects(ctx.run(x.f.db,x.row,x.at));assert.equal(x.b.acceptingOrders,false);count++;
 console.log(JSON.stringify({passed:count,usesDeployedFunctionBody:true,usesLocalTestedImports:true,awsWrites:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
