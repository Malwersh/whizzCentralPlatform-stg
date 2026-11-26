const {quoteHash}=require('../../dist/deliveryQuoteRecord');
function scopeEnv({orders=[{orderId:'order',branchId:'branch',customerSubjectId:'customer'}],drivers=[{driverId:'driver',subjectId:'subject'}],mode='SCOPED',until='2099-01-01T00:00:00.000Z'}={}){
 const config={schemaVersion:1,accountId:'699561669180',region:'us-east-1',scopes:[{id:'synthetic-only',version:1,mode,admitUntil:until,orders,drivers}]};
 return {STAGE:'staging',AWS_REGION:'us-east-1',FINANCE_ROLLOUT_CONFIG:JSON.stringify(config),FINANCE_ROLLOUT_SHA256:quoteHash(config)};
}
function orderId(userId='u1',requestId='abcdefab-1234-4123-8123-123456789abc'){
 return require('../../dist/deliveryQuoteOrder').orderIdFor(userId,requestId);
}
function scopePin(env,oid){const s=JSON.parse(env.FINANCE_ROLLOUT_CONFIG).scopes.find(s=>s.orders.some(o=>o.orderId===oid));return {schemaVersion:1,scopeId:s.id,version:s.version,digest:quoteHash({id:s.id,version:s.version,orders:s.orders,drivers:s.drivers})};}
module.exports={scopeEnv,orderId,scopePin};
