'use strict';const fs=require('fs'),ts=require('../backend/wallet-service/node_modules/typescript'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const p='/private/tmp/merchant-cancel-234',parse=s=>ts.createSourceFile('entry.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function fn(s,name){const t=parse(s),a=t.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(a.length!==1)throw Error('FUNCTION_DRIFT:'+name);return {n:a[0],t};}
let s=fs.readFileSync(p+'/financial-base.js','utf8'),canonical=fs.readFileSync('backend/wallet-service/dist/driverFinancialRuntime.js','utf8');
for(const name of ['financialMerchantCancellation','financialAcceptanceHandler']){
 const {n,t}=fn(canonical,name);let body=n.getText(t);
 for(const [mod,symbol]of [['financialIdentity','authenticateFinancialIdentity'],['customerCancellation','createCustomerCancellation'],['codReassignment','createStagingCodReassignment']])body=body.replaceAll('(0, '+mod+'_1.'+symbol+')','require("./order-exception-runtime-229.js").'+symbol);
 body=body.replaceAll('(0, driverFinancialTransaction_1.strongGet)','strongGet').replaceAll('(0, financialPushValidation_1.createStagingFinancialPushValidation)','createStagingFinancialPushValidation');if(/\b\w+_1\./.test(body))throw Error('UNBOUND_DEPENDENCY:'+name);
 if(name==='financialMerchantCancellation'){if(s.includes('function '+name+'('))throw Error('ALREADY_PRESENT');const old=fn(s,'financialAcceptanceHandler');s=s.slice(0,old.n.getStart(old.t))+body+'\n'+s.slice(old.n.getStart(old.t));}
 else{const old=fn(s,name);s=s.slice(0,old.n.getStart(old.t))+body+s.slice(old.n.end);}
}
fs.writeFileSync(p+'/financial-candidate.js',s);fs.copyFileSync('backend/shared/order-exception-runtime-229.js',p+'/order-exception-runtime-229.js');
let orders=fs.readFileSync(p+'/merchant-orders-base.js','utf8');for(const anchor of ['return { ...view, driverSearchUnavailable:','exceptionCancellation:order.exceptionCancellation||null, driverSearchUnavailable:']){if(orders.split(anchor).length!==2)throw Error('MERCHANT_DTO_DRIFT:'+anchor);orders=orders.replace(anchor,anchor.startsWith('return')?'return { ...view, exceptionPolicyVersion:order.exceptionPolicy?.version||null, driverSearchUnavailable:':'exceptionPolicyVersion:order.exceptionPolicy?.version||null, '+anchor);}fs.writeFileSync(p+'/merchant-orders-candidate.js',orders);
const m=esbuild.buildSync({entryPoints:['../whizzMerchants-stg/backend/functions/auth/order_returns.js'],bundle:true,platform:'node',target:'node20',external:['@aws-sdk/lib-dynamodb'],write:false}).outputFiles[0].contents;fs.writeFileSync(p+'/merchant-auth-candidate.js',m);console.log('Prepared bounded merchant cancellation writer, owner adapter and policy marker DTO.');
