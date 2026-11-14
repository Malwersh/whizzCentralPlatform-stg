'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMerchantSettlementAuthority:create}=require('../dist/merchantSettlementAuthority');
const id='11111111-1111-4111-8111-111111111111',at=Date.parse('2026-10-23T00:00:00.000Z');
function fixture(){
 const employee={pk:'EMPLOYEE#'+id,sk:'PROFILE',employeeId:id,status:'ACTIVE',version:1,roles:['finance_operator'],scope:{allRegions:true,regionIds:[]},mfaRequired:true,minimumAuthTime:0};
 const branch={businessId:'branch1',ownerId:'owner1',cognitoUserId:'owner1',status:'approved'};
 const rows=new Map(),calls=[];rows.set(employee.pk,employee);rows.set('branch1',branch);
 const principal={employeeId:id,authTime:at/1000,mfaEnrolled:true};
 const db={async send(c){calls.push(c);assert.equal(c.constructor.name,'GetCommand');assert.equal(c.input.ConsistentRead,true);return {Item:structuredClone(rows.get(c.input.Key.pk||c.input.Key.businessId))};}};
 return {employee,branch,rows,calls,principal,db,adapter:()=>create({db,principal,now:()=>at})};
}
test('fresh live financial operator gets a pinned authority, with no writes or wallet access',async()=>{
 const f=fixture(),a=await f.adapter()('branch1','CREATE');assert.equal(a.actorId,id);assert.equal(a.guards.length,1);
 const g=a.guards[0].ConditionCheck;assert.equal(g.TableName,'staging-PlatformStaff');
 for(const field of ['roles','scope','minimumAuthTime','mfaRequired','deletionRequestId'])assert(Object.values(g.ExpressionAttributeNames).includes(field));
 assert(f.calls.every(c=>['staging-PlatformStaff','WhizzMerchants_Businesses','staging-AccountDeletion'].includes(c.input.TableName)));
});
test('viewer and approver read statements but cannot create them; unrelated roles cannot read',async()=>{
 for(const role of ['finance_viewer','finance_approver']){const f=fixture();f.employee.roles=[role];await f.adapter()('branch1','READ');await assert.rejects(f.adapter()('branch1','CREATE'),/PERMISSION_REQUIRED/);}
 for(const role of ['commercial_approver','merchant_manager','platform_manager','auditor','unknown']){const f=fixture();f.employee.roles=[role];await assert.rejects(f.adapter()('branch1','READ'),/PERMISSION_REQUIRED/);}
});
test('revocation is re-read for every operation, with region scope enforced',async()=>{
 for(const change of ['suspend','roles','scope','delete','identity','version']){const f=fixture(),a=f.adapter();await a('branch1','READ');if(change==='suspend')f.employee.status='SUSPENDED';if(change==='roles')f.employee.roles=[];if(change==='scope')f.employee.scope.allRegions=false;if(change==='delete')f.employee.deletionRequestId='deletion';if(change==='identity')f.employee.employeeId='other';if(change==='version')f.employee.version=0;await assert.rejects(a('branch1','READ'),/EMPLOYEE_UNAVAILABLE|PERMISSION_REQUIRED/);}
});
test('MFA, revoked sessions, future auth and fresh CREATE are enforced independently of staging session policy',async()=>{
 for(const mode of ['mfa','minimum','invalidMinimum','future','stale']){const f=fixture();if(mode==='mfa')f.principal.mfaEnrolled=false;if(mode==='minimum')f.employee.minimumAuthTime=at/1000+1;if(mode==='invalidMinimum')f.employee.minimumAuthTime='bad';if(mode==='future')f.principal.authTime+=31;if(mode==='stale')f.principal.authTime-=301;await assert.rejects(f.adapter()('branch1','CREATE'),/EMPLOYEE_UNAVAILABLE|REAUTH_REQUIRED/);}
 const f=fixture();f.principal.authTime-=301;await f.adapter()('branch1','READ');
});
test('deleted, suspended, missing or closing branch/owner blocks financial reads too',async()=>{
 for(const mode of ['deleted','status','owner','missing','branchFence','ownerFence']){const f=fixture();if(mode==='deleted')f.branch.isDeleted=true;if(mode==='status')f.branch.status='pending';if(mode==='owner')f.branch.cognitoUserId='other';if(mode==='missing')f.rows.delete('branch1');if(mode==='branchFence')f.rows.set('BUSINESS_LIFECYCLE#MERCHANT#branch1',{});if(mode==='ownerFence')f.rows.set('ACCOUNT_LIFECYCLE#MERCHANT#owner1',{});await assert.rejects(f.adapter()('branch1','READ'),/BRANCH_UNAVAILABLE/);}
});
test('invalid principal or operation fails before database I/O; principal is detached',async()=>{
 for(const principal of [null,{}, {employeeId:'bodyActor',authTime:1,mfaEnrolled:true},{employeeId:id,authTime:1,mfaEnrolled:'yes'}]){const f=fixture();assert.throws(()=>create({db:f.db,principal}),/VERIFIED_PRINCIPAL_REQUIRED/);assert.equal(f.calls.length,0);}
 const f=fixture(),a=f.adapter();f.principal.employeeId='attacker';await a('branch1','READ');
 const g=fixture();await assert.rejects(g.adapter()('branch1','PAY'),/INVALID_SETTLEMENT_AUTHORIZATION/);assert.equal(g.calls.length,0);
});

test('deletion existence checks request only pk/sk under deployed attribute-restricted IAM',async()=>{
 const f=fixture();await f.adapter()('branch1','READ');const calls=f.calls.filter(c=>c.input.TableName==='staging-AccountDeletion');assert.equal(calls.length,2);
 for(const c of calls){assert.deepEqual(Object.values(c.input.ExpressionAttributeNames).sort(),['pk','sk']);assert.equal(c.input.ProjectionExpression,'#pk,#sk');assert.equal(c.input.ConsistentRead,true);}
});


test('staging verified-session policy permits saving after five minutes while live revocation and MFA still block',async()=>{
 const before={environment:process.env.PLATFORM_ENVIRONMENT,policy:process.env.PLATFORM_SESSION_POLICY};
 try{
 process.env.PLATFORM_ENVIRONMENT='staging';process.env.PLATFORM_SESSION_POLICY='VALID_SESSION';
 const f=fixture();f.principal.authTime-=7200;await f.adapter()('branch1','CREATE');
 f.employee.minimumAuthTime=f.principal.authTime+1;await assert.rejects(f.adapter()('branch1','CREATE'),/EMPLOYEE_UNAVAILABLE/);
 const g=fixture();g.principal.authTime-=7200;g.principal.mfaEnrolled=false;await assert.rejects(g.adapter()('branch1','CREATE'),/EMPLOYEE_UNAVAILABLE/);
 const h=fixture();h.principal.authTime-=7200;h.employee.status='SUSPENDED';await assert.rejects(h.adapter()('branch1','CREATE'),/EMPLOYEE_UNAVAILABLE/);
 process.env.PLATFORM_ENVIRONMENT='production';const p=fixture();p.principal.authTime-=7200;await assert.rejects(p.adapter()('branch1','CREATE'),/REAUTH_REQUIRED/);
 }finally{for(const [key,value] of [['PLATFORM_ENVIRONMENT',before.environment],['PLATFORM_SESSION_POLICY',before.policy]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
