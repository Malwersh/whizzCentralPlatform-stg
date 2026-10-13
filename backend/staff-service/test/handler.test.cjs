const {test}=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const original=Module._load,A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',D='44444444-4444-4444-8444-444444444444';
let claims,items,writes,enabled,invalid,race,enrolled,confirmed;
class Command{constructor(input){this.input=input;}}
class GetCommand extends Command{};class ScanCommand extends Command{};class DeleteCommand extends Command{};class TransactWriteCommand extends Command{};
Module._load=function(n,p,i){
 if(n==='@aws-sdk/client-dynamodb')return {DynamoDBClient:class{}};
 if(n==='@aws-sdk/lib-dynamodb')return {GetCommand,ScanCommand,DeleteCommand,TransactWriteCommand,DynamoDBDocumentClient:{from:()=>({send:async c=>{if(c instanceof GetCommand)return {Item:c.input.Key.regionId?{regionId:c.input.Key.regionId}:items[c.input.Key.pk]};if(c instanceof TransactWriteCommand){if(race)throw Object.assign(Error(),{name:'TransactionCanceledException'});writes.push(c.input);return {};}return {Items:[]};}})}};
 if(n==='@aws-sdk/client-cognito-identity-provider')return {CognitoIdentityProviderClient:class{async send(){return {Enabled:enabled,UserMFASettingList:enrolled?['SOFTWARE_TOKEN_MFA']:[],UserStatus:confirmed?'CONFIRMED':'FORCE_CHANGE_PASSWORD'};}},AdminGetUserCommand:Command,AdminUserGlobalSignOutCommand:Command};
 if(n==='aws-jwt-verify')return {CognitoJwtVerifier:{create:()=>({verify:async()=>{if(invalid)throw Error();return claims;}})}};
 return original(n,p,i);
};
process.env.STAFF_TABLE='test';const {handler}=require('../index');Module._load=original;
function person(id,roles){return {employeeId:id,username:id,status:'ACTIVE',version:1,roles,scope:{allRegions:true,regionIds:[]},approvalLimit:0};}
function reset(){claims={sub:A,username:A,auth_time:Math.floor(Date.now()/1000)};items={['EMPLOYEE#'+A]:person(A,['staff_manager','staff_approver']),['EMPLOYEE#'+B]:person(B,['customer_service']),['EMPLOYEE#'+C]:person(C,['staff_manager'])};writes=[];enabled=true;invalid=false;race=false;enrolled=true;confirmed=true;}
const assignment=()=>({employeeId:B,version:1,roles:['driver_reviewer'],status:'ACTIVE',scope:{allRegions:false,regionIds:['baghdad']},approvalLimit:0,reason:'تعديل مهام الموظف'});
const request=(path,body)=>handler({httpMethod:'POST',path,headers:{authorization:'Bearer test'},body:JSON.stringify(body)});
function pending(){items['CHANGE#'+D]={pk:'CHANGE#'+D,sk:'META',changeId:D,employeeId:B,requestedBy:C,requestedByVersion:1,baseVersion:1,status:'PENDING',expiresAt:Math.floor(Date.now()/1000)+3600,assignment:assignment()};}
test('invalid JWT rejects access',async()=>{reset();invalid=true;assert.equal((await request('/staff/changes',assignment())).statusCode,401);});
test('disabled identity rejects still valid token',async()=>{reset();enabled=false;assert.equal((await request('/staff/changes',assignment())).statusCode,403);assert.equal(writes.length,0);});
test('self role change is forbidden',async()=>{reset();assert.equal((await request('/staff/changes',{...assignment(),employeeId:A})).statusCode,403);});
test('recent login required',async()=>{reset();claims.auth_time-=301;assert.equal((await request('/staff/changes',assignment())).statusCode,403);});
test('malformed body is client error',async()=>{reset();assert.equal((await handler({httpMethod:'POST',path:'/staff/changes',headers:{},body:'{'})).statusCode,400);});
test('proposal guards actor and target versions',async()=>{reset();assert.equal((await request('/staff/changes',assignment())).statusCode,201);assert.equal(writes[0].TransactItems.filter(x=>x.ConditionCheck).length,2);});
test('maker cannot approve',async()=>{reset();pending();items['CHANGE#'+D].requestedBy=A;assert.equal((await request('/staff/changes/approve',{changeId:D})).statusCode,403);assert.equal(writes.length,0);});
test('revoked maker invalidates proposal',async()=>{reset();pending();items['EMPLOYEE#'+C].status='SUSPENDED';assert.equal((await request('/staff/changes/approve',{changeId:D})).statusCode,403);});
test('approval guards both actors and increments target version',async()=>{reset();pending();assert.equal((await request('/staff/changes/approve',{changeId:D})).statusCode,200);const parts=writes[0].TransactItems;assert.equal(parts.filter(x=>x.ConditionCheck).length,2);assert.equal(parts.find(x=>x.Put?.Item.employeeId===B).Put.Item.version,2);});
test('concurrent version change returns conflict',async()=>{reset();pending();race=true;assert.equal((await request('/staff/changes/approve',{changeId:D})).statusCode,409);});
test('changed maker version invalidates a pending proposal',async()=>{reset();pending();items['EMPLOYEE#'+C].version=2;assert.equal((await request('/staff/changes/approve',{changeId:D})).statusCode,403);assert.equal(writes.length,0);});
test('editing bootstrap account is forbidden',async()=>{reset();items['EMPLOYEE#'+B].roles=['bootstrap_admin'];assert.equal((await request('/staff/changes',assignment())).statusCode,403);assert.equal(writes.length,0);});
test('target cannot approve their proposed change',async()=>{reset();pending();claims.sub=B;items['EMPLOYEE#'+B].roles=['staff_approver'];assert.equal((await request('/staff/changes/approve',{changeId:D})).statusCode,403);assert.equal(writes.length,0);});
test('rejection requires an independent approver and reason',async()=>{reset();pending();const result=await request('/staff/changes/reject',{changeId:D,reason:'الصلاحيات المقترحة أوسع من مهام الموظف'});assert.equal(result.statusCode,200);assert.equal(writes[0].TransactItems.find(x=>x.Update).Update.ExpressionAttributeValues[':rejected'],'REJECTED');});
test('maker cannot reject as an independent reviewer',async()=>{reset();pending();items['CHANGE#'+D].requestedBy=A;assert.equal((await request('/staff/changes/reject',{changeId:D,reason:'رفض غير معتمد'})).statusCode,403);});
test('approval creates durable revocation in the same transaction',async()=>{reset();pending();assert.equal((await request('/staff/changes/approve',{changeId:D})).statusCode,200);assert.equal(writes[0].TransactItems.find(x=>x.Put?.Item.pk==='REVOCATIONS').Put.Item.username,B);});

test('invited account exposes no operational permissions',async()=>{reset();items['EMPLOYEE#'+A].status='INVITED';const result=await handler({httpMethod:'GET',path:'/staff/me',headers:{}});assert.equal(result.statusCode,200);assert.deepEqual(JSON.parse(result.body).permissions,[]);});
test('activation requires both completed password setup and TOTP',async()=>{for(const flag of ['mfa','password']){reset();items['EMPLOYEE#'+A].status='INVITED';items['EMPLOYEE#'+A].activationApproved=true;if(flag==='mfa')enrolled=false;else confirmed=false;assert.equal((await request('/staff/enrollment/finish',{})).statusCode,403);assert.equal(writes.length,0);}});
test('activation forces new authentication and preserves preapproved roles',async()=>{reset();items['EMPLOYEE#'+A].status='INVITED';items['EMPLOYEE#'+A].activationApproved=true;assert.equal((await request('/staff/enrollment/finish',{})).statusCode,200);const activated=writes[0].TransactItems[0].Put.Item;assert.equal(activated.status,'ACTIVE');assert(activated.minimumAuthTime>claims.auth_time);assert.deepEqual(activated.roles,['staff_manager','staff_approver']);items['EMPLOYEE#'+A]=activated;assert.equal((await handler({httpMethod:'GET',path:'/staff/catalog',headers:{}})).statusCode,403);});
