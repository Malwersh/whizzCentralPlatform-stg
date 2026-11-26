const test=require('node:test');
const assert=require('node:assert/strict');
const {financialTarget}=require('../financial-target');
test('staging retains its verified target',()=>assert.equal(financialTarget({ENVIRONMENT:'staging'}),'arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept'));
for(const ENVIRONMENT of ['prod','production']) {
 test(ENVIRONMENT+' refuses missing or foreign targets',()=>{
  for(const target of [undefined,'','arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept','arn:aws:lambda:us-east-1:746727375268:function:old-service','arn:aws:lambda:us-west-2:746727375268:function:wizz-production-financial']) {
   assert.throws(()=>financialTarget({ENVIRONMENT,FINANCIAL_WORKFLOW_FUNCTION_ARN:target}),{message:'FINANCIAL_WORKFLOW_NOT_CONFIGURED',status:503});
  }
 });
 test(ENVIRONMENT+' resolves isolated production binding',()=>{
  const target='arn:aws:lambda:us-east-1:746727375268:function:wizz-production-financial';
  assert.equal(financialTarget({ENVIRONMENT,FINANCIAL_WORKFLOW_FUNCTION_ARN:target}),target);
 });
}

test('customer cancellation invokes the designated production service only',async()=>{
 const {invokeCustomerCancellation}=require('../financial-cancellation-client');
 const saved={...process.env};
 const event={headers:{Authorization:'Bearer customer-access-token'}};
 const body={orderId:'order1',cancellationAction:'preview'};
 const target='arn:aws:lambda:us-east-1:746727375268:function:wizz-production-order-financial';
 const calls=[];
 const client={async send(command){
  calls.push(command.input);
  return {Payload:Buffer.from(JSON.stringify({statusCode:200,result:{success:true,orderId:'order1'}}))};
 }};
 try{
  process.env.ENVIRONMENT='production';
  process.env.FINANCIAL_WORKFLOW_FUNCTION_ARN=target+'-other';
  await assert.rejects(invokeCustomerCancellation(event,body,client),{status:503});
  assert.equal(calls.length,0);
  process.env.FINANCIAL_WORKFLOW_FUNCTION_ARN=target;
  await invokeCustomerCancellation(event,body,client);
  assert.equal(calls[0].FunctionName,target);
  assert.deepEqual(JSON.parse(Buffer.from(calls[0].Payload)),{
   action:'read_customer_cancellation',accessToken:'customer-access-token',body:{orderId:'order1'}
  });
 }finally{process.env=saved;}
});
