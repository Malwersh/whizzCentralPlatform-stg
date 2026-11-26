const test=require('node:test'),assert=require('node:assert/strict');
const {orderBindings}=require('../dist/orderBindings');
const names=['ORDERS_TABLE','STAFF_TABLE','BUSINESSES_TABLE','OFFER_JOURNEY_TABLE','MERCHANT_DISCOUNTS_TABLE','PLATFORM_DISCOUNTS_TABLE'];
function configured(){
 const env={ENVIRONMENT:'production'};
 for(const name of names)env[name]='wizz-production-'+name.toLowerCase();
 for(const prefix of ['CUSTOMER','DRIVER','MERCHANT','SERVICE','CENTRAL']){
  env[prefix+'_USER_POOL_ID']='us-east-1_Prod'+prefix;
  env[prefix+'_CLIENT_ID']='production'+prefix.toLowerCase();
 }
 return env;
}
test('staging preserves existing identity and table defaults',()=>{
 const b=orderBindings({ENVIRONMENT:'staging'});
 assert.equal(b.tables.ORDERS_TABLE,'WizzOrders');
 assert.equal(b.tables.OFFER_JOURNEY_TABLE,'staging-WizzOfferJourney');
 assert.equal(b.pools[0].userPoolId,'us-east-1_TpyyrVkEE');
});
test('production requires every table explicitly',()=>{
 for(const name of names){const env=configured();delete env[name];assert.throws(()=>orderBindings(env),/ORDER_BINDING_NOT_CONFIGURED/);}
});
test('production rejects staging and invalid table bindings',()=>{
 for(const value of ['staging-PlatformStaff','WizzOrders','null','undefined','']){
  assert.throws(()=>orderBindings({...configured(),STAFF_TABLE:value}),/ORDER_BINDING_NOT_CONFIGURED/);
 }
});
test('production rejects missing and legacy identities',()=>{
 for(const prefix of ['CUSTOMER','DRIVER','MERCHANT','SERVICE','CENTRAL']){
  const env=configured();delete env[prefix+'_CLIENT_ID'];assert.throws(()=>orderBindings(env),/ORDER_BINDING_NOT_CONFIGURED/);
 }
 assert.throws(()=>orderBindings({...configured(),CUSTOMER_USER_POOL_ID:'us-east-1_TpyyrVkEE'}));
 assert.throws(()=>orderBindings({...configured(),CENTRAL_CLIENT_ID:'17mu2qlqis0qcs1n1n980q7e3j'}));
});
test('production uses configured resources and distinct identity pools',()=>{
 const env=configured(),b=orderBindings(env);
 assert.equal(b.tables.ORDERS_TABLE,env.ORDERS_TABLE);
 assert.equal(b.pools.find(p=>p.kind==='restaurant').userPoolId,env.MERCHANT_USER_POOL_ID);
 assert.throws(()=>orderBindings({...env,DRIVER_USER_POOL_ID:env.CUSTOMER_USER_POOL_ID}));
});
