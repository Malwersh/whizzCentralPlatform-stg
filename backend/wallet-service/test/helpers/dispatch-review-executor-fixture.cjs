const {setup}=require('./dispatch-legacy-source-fixture.cjs');
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createStagingDispatchCoordinator}=require('../../dist/dispatchCoordinator');
const {createStagingDispatchReviewExecutor}=require('../../dist/dispatchReviewExecutor');
const {exactCheck}=require('../../dist/driverFinancialTransaction');
const {route,PATH}=require('../../../staff-service/dispatch-reviews');
async function fixture(action='CANCEL_BEFORE_PICKUP',beforeRequest=()=>{}){
 const f=await setup(),table='staging-PlatformStaff',base=f.db.send;f.db.send=async c=>{
  if(c.constructor.name==='QueryCommand'){const q=c.input;let rows=[...f.rows.entries()].filter(([k,r])=>k.startsWith(q.TableName+'|')&&r.orderId===q.ExpressionAttributeValues[':id']&&(q.TableName!=='WizzDispatchJobs_staging'||r.SK.startsWith(q.ExpressionAttributeValues[':prefix']??'DISPATCH_ACCEPTANCE#'))).map(([,r])=>structuredClone(r));return f.queryOverride?f.queryOverride(c,rows):{Items:rows};}
  if(c.constructor.name==='GetCommand')return base(new GetCommand(c.input));
  if(c.constructor.name==='TransactWriteCommand')return base(new TransactWriteCommand(c.input));throw Error(c.constructor.name);
 };
 Object.assign(f.get('WhizzMerchants_Businesses',{businessId:'branch1'}),{isActive:true});f.time=Date.parse(f.job().expiresAt)+1;
 await createStagingDispatchCoordinator({db:f.db,now:()=>f.time}).plan({orderId:'order1',assignmentId:'dispatch1',source:'TIMEOUT'});
 const actor={pk:'EMPLOYEE#eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',sk:'PROFILE',employeeId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',username:'staff-test',status:'ACTIVE',version:1,roles:['operations'],scope:{allRegions:false,regionIds:['zone1']}};f.put(table,actor);
 f.live={Enabled:true,UserStatus:'CONFIRMED',UserMFASettingList:['SOFTWARE_TOKEN_MFA'],UserAttributes:[{Name:'sub',Value:actor.employeeId}]};f.providerCalls=0;
 f.cognito={send:async c=>{f.providerCalls++;if(f.providerError)throw Error('provider offline');if(c.input.UserPoolId!=='us-east-1_wz7vwZZxz'||c.input.Username!=='staff-test')throw Error('wrong identity');return structuredClone(f.live);}};
 f.ctx={db:f.db,table,mode:'REQUESTS_ONLY',employee:async()=>f.get(table,{pk:actor.pk,sk:'PROFILE'}),guard:a=>exactCheck(table,{pk:a.pk,sk:a.sk},a),audit:(id,action,before,after,ref)=>({Put:{TableName:table,Item:{pk:'AUDIT',sk:ref,actorId:id,action,before,after},ConditionExpression:'attribute_not_exists(pk)'}}),enrolled:true,recent:()=>{},claims:{}};
 f.actor=()=>f.get(table,{pk:actor.pk,sk:'PROFILE'});f.details=()=>route({...f.ctx,query:{orderId:'order1',source:'SEARCH'}},f.actor(),'GET',PATH);
 beforeRequest(f);const {item}=await f.details();await route(f.ctx,f.actor(),'POST',PATH+'/decisions',{selector:{orderId:'order1',source:'SEARCH'},action,baseDigest:item.baseDigest,requestId:'11111111-1111-4111-8111-111111111111',reason:'اختبار تنفيذ مخول'});
 f.decision=()=>[...f.rows.values()].find(r=>r.kind==='DISPATCH_REVIEW_DECISION');f.run=()=>createStagingDispatchReviewExecutor({db:f.db,cognito:f.cognito,now:()=>f.time,mode:'SAFE_INITIAL_LEGACY'}).process(f.decision().caseId);
 f.decision().createdAt=new Date(f.time).toISOString();return f;
}
module.exports={fixture};
