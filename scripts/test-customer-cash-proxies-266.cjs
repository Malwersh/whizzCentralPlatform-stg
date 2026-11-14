const {test}=require('node:test'),assert=require('node:assert/strict');
const customer=require('../backend/order-service/customer-cash-case-client');
const staff=require('../backend/staff-service/order-exception-case-client');
const driver=require('../../whizzDrivers-stg/backend/financial-accept-client');
const success={success:true,orderId:'order1'};
function client(check){return {send:async cmd=>{check(JSON.parse(Buffer.from(cmd.input.Payload).toString()));return {Payload:Buffer.from(JSON.stringify({statusCode:200,result:success}))};}};}
test('customer workflow is isolated from cancellation and never selects a caller supplied staff actor',async()=>{
 const input={workflow:'CUSTOMER_CASH_REVIEW',action:'READ_CUSTOMER_CASH_CASE',orderId:'order1'};
 assert.deepEqual(await customer.invokeCustomerCashCase({headers:{Authorization:'Bearer original'}},input,client(v=>{assert.equal(v.action,'customer_cash_case');assert.equal(v.accessToken,'original');assert.deepEqual(v.body,{action:'READ_CUSTOMER_CASH_CASE',orderId:'order1'});})),success);
 await assert.rejects(customer.invokeCustomerCashCase({headers:{Authorization:'Bearer original'}},{...input,action:'APPROVE_CUSTOMER_REFUND'},client(()=>assert.fail())),/INVALID/);
 await assert.rejects(customer.invokeCustomerCashCase({headers:{}},input,client(()=>assert.fail())),/UNAUTHORIZED/);
});
test('staff cash case selector routes only to its canonical order aggregate while ordinary cases retain their writer',async()=>{
 await staff.invoke('original',{caseKey:'CUSTOMER_CASH_REVIEW',caseId:'case1',orderId:'order1',action:'APPROVE_CUSTOMER_REFUND'},client(v=>{assert.equal(v.action,'staff_cash_case');assert.equal(v.accessToken,'original');assert.deepEqual(v.body,{orderId:'order1',action:'APPROVE_CUSTOMER_REFUND'});}));
 await staff.invoke('original',{caseKey:'RETURN#1',orderId:'order1'},client(v=>assert.equal(v.action,'exception_case_admin')));
});
test('driver proxy preserves the original credential and retains existing rollout gates',async()=>{
 const before={...process.env};try{
 process.env.FINANCIAL_DISPATCH_MODE='REQUIRED';process.env.FINANCIAL_COD_RETURNS_MODE='REQUIRED';process.env.FINANCIAL_ACCEPT_FUNCTION_ARN='arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept';
 await driver.invokeFinancialOperation({orderId:'order1',action:'REPORT_CASH_PAYMENT'},'driver-original','driver_cash_case',client(v=>{assert.equal(v.action,'driver_cash_case');assert.equal(v.accessToken,'driver-original');}));
 await assert.rejects(driver.invokeFinancialOperation({},'driver-original','staff_cash_case',client(()=>assert.fail())),/INVALID/);
 process.env.FINANCIAL_COD_RETURNS_MODE='OFF';await assert.rejects(driver.invokeFinancialOperation({},'driver-original','driver_cash_case',client(()=>assert.fail())),/DISABLED/);
 }finally{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);}
});
