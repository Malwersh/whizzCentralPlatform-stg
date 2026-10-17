'use strict';
// Offline, private build input. Contains identifiers, never credentials or permission.
const fs=require('node:fs');
const {readFinanceRollout}=require('../backend/wallet-service/dist/financeRollout');
const {orderIdFor}=require('../backend/wallet-service/dist/deliveryQuoteOrder');
function prepare(env,attempt,now=Date.now()){
 const cfg=readFinanceRollout(env);
 if(!attempt||Object.keys(attempt).sort().join(',')!=='branchId,customerSubjectId,requestId,userId'||
  ![attempt.userId,attempt.customerSubjectId,attempt.branchId].every(x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,149}$/.test(x)&&x!=='guest')||
  !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(attempt.requestId||''))throw Error('INVALID_TEST_ATTEMPT');
 const orderId=orderIdFor(attempt.userId,attempt.requestId);
 const scope=cfg.scopes.find(s=>s.orders.some(o=>o.orderId===orderId&&o.branchId===attempt.branchId&&o.customerSubjectId===attempt.customerSubjectId));
 if(!scope||scope.mode!=='SCOPED'||Date.parse(scope.admitUntil)<=now)throw Error('PREAPPROVED_OPEN_ORDER_REQUIRED');
 return {orderId,scopeId:scope.id,scopeVersion:scope.version,activationAuthorized:false,
  defines:{ENVIRONMENT:'staging',DELIVERY_QUOTES_ENABLED:'true',COMMERCIAL_PRICING_ENABLED:'true',
   API_URL:'https://4jut6787c8.execute-api.us-east-1.amazonaws.com/staging',
   FINANCE_TEST_CHECKOUT_ATTEMPT:JSON.stringify({schemaVersion:1,userId:attempt.userId,branchId:attempt.branchId,requestId:attempt.requestId})}};
}
module.exports={prepare};
if(require.main===module){try{
 const result=prepare(JSON.parse(fs.readFileSync(process.argv[2])),JSON.parse(fs.readFileSync(process.argv[3])));
 const file=process.argv[4];if(fs.existsSync(file))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 fs.writeFileSync(file,JSON.stringify(result.defines,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({prepared:true,activationAuthorized:false}));
}catch(e){console.error(e.message);process.exitCode=1;}}
