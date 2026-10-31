'use strict';
const fs=require('fs'),ts=require('../backend/wallet-service/node_modules/typescript');
const p='/private/tmp/exceptions-229',source=fs.readFileSync(p+'/financial-base.js','utf8'),ast=ts.createSourceFile('index.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const fn=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createStagingCodReturn');if(fn.length!==1)throw Error('ACTUAL_RETURN_ENTRY_CHANGED');
const n=fn[0];let output=source.slice(0,n.getStart(ast))+'function createStagingCodReturn(options) { return require("./order-exception-runtime-229.js").createStagingCodReturn(options); }'+source.slice(n.end);
// Authenticate before any order read; then register saved general membership before subject checks.
for(const name of ['financialCodReturn','financialAssignmentTransition']){
 const tree=ts.createSourceFile('index.js',output,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(!node)throw Error('RUNTIME_FUNCTION_MISSING');
 let chunk=node.getText(tree);
 const before='  await rollout.order(body.orderId, "DRAIN");\n';
 const auth='const actor = await authenticateFinancialIdentity(cognito, accessToken, owner ? "MERCHANT_OWNER" : "DRIVER");';
 if(chunk.split(before).length!==2||chunk.split(auth).length!==2)throw Error('AUTH_ORDER_ANCHOR_CHANGED');
 chunk=chunk.replace(before,'').replace(auth,auth+'\n    await rollout.order(body.orderId, "DRAIN");');
 output=output.slice(0,node.getStart(tree))+chunk+output.slice(node.end);
}
fs.writeFileSync(p+'/financial-candidate.js',output);fs.copyFileSync('backend/shared/order-exception-runtime-229.js',p+'/order-exception-runtime-229.js');
const base=fs.readFileSync(p+'/customer-base.js','utf8'),candidate=fs.readFileSync(p+'/customer-candidate.js','utf8');
const addition='\n      if(commercial.settlementModel==="FULL_CASH_AT_DELIVERY_V1")order.exceptionPolicy=require("../../checkout-finance-runtime-222.js").createOrderExceptionPolicy(order.createdAt);';
if(candidate.replace(addition,'')!==base)throw Error('UNRELATED_CUSTOMER_ENTRY_DRIFT');
console.log('PASS two bounded entry changes; customer only policy pin, financial only return factory bridge.');
