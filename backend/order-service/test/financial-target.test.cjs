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
