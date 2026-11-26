const {test}=require('node:test');
const assert=require('node:assert/strict');
const {docClient}=require('../dist/db');
const {HoldService}=require('../dist/holdService');

test('production hold fails before any database access when order binding is absent or foreign',async()=>{
 const saved={...process.env};
 const original=docClient.send;
 let calls=0;
 docClient.send=async()=>{calls++;throw Error('Unexpected database access');};
 try {
  process.env.ENVIRONMENT='production';process.env.PLATFORM_ENVIRONMENT='production';process.env.AWS_REGION='us-east-1';
  for(const field of ['WALLETS','LEDGER','HOLDS','TOPUP_REQUESTS','AUDIT_LOG','IDEMPOTENCY_KEYS'])process.env[field+'_TABLE']='wizz-production-'+field;
  for(const value of [undefined,'WizzOrders_staging']){
   if(value===undefined)delete process.env.ORDERS_TABLE;else process.env.ORDERS_TABLE=value;
   await assert.rejects(new HoldService().createHold({walletId:'WALLET#DRIVER#test',amount:1000,orderId:'test'}),/ORDERS_TABLE/);
  }
  assert.equal(calls,0);
 } finally {
  docClient.send=original;
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];
  Object.assign(process.env,saved);
 }
});
