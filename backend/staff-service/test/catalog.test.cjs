const {test}=require('node:test');
const assert=require('node:assert/strict');
const {effective,allowed,validateAssignment}=require('../catalog');
const employee={status:'ACTIVE',roles:['customer_service','driver_reviewer'],scope:{allRegions:false,regionIds:['baghdad']},approvalLimit:0};
test('multiple roles combine permissions without financial elevation',()=>{
 assert(effective(employee).includes('support.reply'));
 assert(effective(employee).includes('drivers.review'));
 assert(!allowed(employee,'finance.approve'));
});
test('regional permission cannot cross assigned regions',()=>{
 assert(allowed(employee,'drivers.review','baghdad'));
 assert(!allowed(employee,'drivers.review','basra'));
 assert(!allowed(employee,'drivers.review',null));
});
test('suspended and unknown employees fail closed',()=>{
 assert.deepEqual(effective({...employee,status:'SUSPENDED'}),[]);
 assert(!allowed(null,'staff.read'));
 assert.deepEqual(effective({...employee,roles:['unknown']}),[]);
});
test('bootstrap privilege cannot be assigned through role editing',()=>{
 assert.throws(()=>validateAssignment({...employee,roles:['bootstrap_admin']}),/INVALID_ROLES/);
});
test('financial authority requires global scope and bounded integer limit',()=>{
 assert.throws(()=>validateAssignment({...employee,roles:['finance_approver']}),/GLOBAL_ROLE/);
 assert.throws(()=>validateAssignment({...employee,approvalLimit:1.5}),/INVALID_APPROVAL_LIMIT/);
});
test('valid assignment deduplicates roles and regions',()=>{
 const value=validateAssignment({...employee,roles:['customer_service','customer_service']});
 assert.deepEqual(value.roles,['customer_service']);
});
test('prototype keys cannot be used as role IDs',()=>{
 assert.throws(()=>validateAssignment({...employee,roles:['__proto__']}),/INVALID_ROLES/);
 assert.throws(()=>validateAssignment({...employee,roles:['constructor']}),/INVALID_ROLES/);
 assert.deepEqual(effective({...employee,roles:['__proto__']}),[]);
});
