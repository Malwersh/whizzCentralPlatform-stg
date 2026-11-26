const fs=require('fs'),ts=require(process.cwd()+'/backend/wallet-service/node_modules/typescript'),path=require('path'),assert=require('assert/strict');const p=path.join(process.cwd(),'backend/.tmp/handover-248');
let helper=fs.readFileSync(p+'/financial-order-exception-runtime-229.js','utf8');
for(const name of ['createStagingCodReassignment','createCustomerCancellation']){
 const ast=ts.createSourceFile('runtime.js',helper,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),decl=ast.statements.filter(x=>ts.isFunctionDeclaration(x)&&x.name?.text===name);assert.equal(decl.length,1);const d=decl[0];helper=helper.slice(0,d.getStart(ast))+`function ${name}(options){return require('./staff-order-management-runtime.js').${name}(options);}`+helper.slice(d.end);
}
fs.writeFileSync(p+'/helper-candidate.js',helper);
let root=fs.readFileSync(p+'/financial-index.js','utf8');root+=`\nconst previousMerchantHandoverHandler=module.exports.financialAcceptanceHandler;\nmodule.exports={...module.exports,financialAcceptanceHandler:async(event,...args)=>event?.action==='merchant_handover'?require('./merchant-handover-runtime.js').handler(event):previousMerchantHandoverHandler(event,...args)};\n`;fs.writeFileSync(p+'/financial-candidate.js',root);
let auth=fs.readFileSync(p+'/auth-order_returns.js','utf8');const marker='async function route(';const pos=auth.indexOf('{\n',auth.indexOf(marker));assert(pos>0);auth=auth.slice(0,pos+2)+" if(event.path==='/auth/order-cancellation'&&input?.handover===true)return require('./merchant_handover_proxy').route(event,input,client);\n"+auth.slice(pos+2);fs.writeFileSync(p+'/auth-candidate.js',auth);
let orders=fs.readFileSync(p+'/orders-merchant_order_handler.js','utf8');
// Both limited list projection and batch merge must carry custody evidence.
const needle='pickedUpAt: order.pickedUpAt || null,';assert(orders.includes(needle));orders=orders.replace(needle,'merchantHandover: order.merchantHandover || null, '+needle);
const merge='pickedUpAt: fullOrder.pickedUpAt || limitedOrders[i].pickedUpAt,';if(orders.includes(merge))orders=orders.replace(merge,'merchantHandover: fullOrder.merchantHandover || limitedOrders[i].merchantHandover, '+merge);fs.writeFileSync(p+'/orders-candidate.js',orders);
console.log('Prepared isolated runtime updates and handover list projection.');
