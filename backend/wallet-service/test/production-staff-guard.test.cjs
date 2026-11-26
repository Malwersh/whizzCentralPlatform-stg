const {test}=require('node:test');
const assert=require('node:assert/strict');
const {docClient}=require('../dist/db');
const {financialStaff}=require('../dist/staffAccess');
test('production financial actions fail closed without staff configuration',async()=>{
 const saved={...process.env};const original=docClient.send;let calls=0;
 try{
  docClient.send=async()=>{calls++;return {};};
  delete process.env.STAFF_TABLE;
  for(const field of ['ENVIRONMENT','PLATFORM_ENVIRONMENT'])for(const environment of ['production','prod']){
   delete process.env.ENVIRONMENT;delete process.env.PLATFORM_ENVIRONMENT;
   process.env[field]=environment;
   await assert.rejects(()=>financialStaff('employee','finance.approve'),e=>e.code==='STAFF_CONFIGURATION_REQUIRED');
  }
  assert.equal(calls,0);
 }finally{docClient.send=original;for(const key of ['STAFF_TABLE','ENVIRONMENT','PLATFORM_ENVIRONMENT'])if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
});
