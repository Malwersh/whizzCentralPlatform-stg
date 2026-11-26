'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {prepareInitialConfig}=require('./config.cjs');
const input={policyVersion:'12345678-1234-1234-1234-123456789abc',actorId:'admin',now:'2026-11-17T12:00:00Z'};
test('initial configuration is production-only, closed, versioned and cannot overwrite',()=>{
 const tx=prepareInitialConfig(input);assert.equal(tx.TransactItems.length,2);
 for(const {Put:p} of tx.TransactItems){assert.equal(p.TableName,'wizz-production-PlatformStaff');assert.equal(p.ConditionExpression,'attribute_not_exists(pk)');assert.equal(p.Item.values.partnershipReady,false);assert.ok(p.Item.values.types.every(t=>t.registrationOpen===false));assert.equal(p.Item.updatedBy,'admin');assert.ok(!JSON.stringify(p.Item).includes('staging'));}
 assert.equal(tx.TransactItems[1].Put.Item.sk,'VERSION#'+input.policyVersion);
});
test('configuration requires recorded actor, version and timestamp',()=>{
 for(const patch of [{actorId:''},{policyVersion:'current'},{now:'bad'}])assert.throws(()=>prepareInitialConfig({...input,...patch}),/INVALID_CONFIG_IDENTITY/);
});
