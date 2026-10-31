'use strict';const fs=require('fs'),ts=require('../backend/wallet-service/node_modules/typescript'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const p='/private/tmp/findings-235',parse=s=>ts.createSourceFile('entry.js',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function fn(s,name){const t=parse(s),a=t.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(a.length!==1)throw Error('FUNCTION_DRIFT:'+name);return {n:a[0],t};}
let s=fs.readFileSync(p+'/financial-base.js','utf8'),canonical=fs.readFileSync('backend/wallet-service/dist/driverFinancialRuntime.js','utf8');
for(const name of ['financialAcceptanceHandler']){
 const {n,t}=fn(canonical,name);let body=n.getText(t);
 for(const [mod,symbol]of [['financialIdentity','authenticateFinancialIdentity'],['codReturn','createStagingCodReturn'],['returnDisposition','createReturnDisposition']])body=body.replaceAll('(0, '+mod+'_1.'+symbol+')','require("./order-exception-runtime-229.js").'+symbol);
 body=body.replaceAll('(0, financialPushValidation_1.createStagingFinancialPushValidation)','createStagingFinancialPushValidation');if(/\b\w+_1\./.test(body))throw Error('UNBOUND_DEPENDENCY:'+name);
 const old=fn(s,name);s=s.slice(0,old.n.getStart(old.t))+body+s.slice(old.n.end);
}
fs.writeFileSync(p+'/financial-candidate.js',s);fs.copyFileSync('backend/shared/order-exception-runtime-229.js',p+'/order-exception-runtime-229.js');
console.log('Prepared bounded case-findings runtime and handler errors.');
