const {fixture:funded}=require('./delivery-funded-dispatch-fixture.cjs');
const {createStagingDispatchReviewExecutor}=require('../../dist/dispatchReviewExecutor');
const {createStagingDispatchRestartStart}=require('../../dist/dispatchRestartStart');
const {exactCheck}=require('../../dist/driverFinancialTransaction');
const {route,PATH}=require('../../../staff-service/dispatch-reviews');
async function fixture(){
 const f=await funded(),base=f.db.send;f.db.send=async command=>{
  if(command.constructor.name==='QueryCommand'){
   const q=command.input,rows=[...f.rows.entries()].filter(([k,r])=>k.startsWith(q.TableName+'|')&&r.orderId===q.ExpressionAttributeValues[':id']&&(!q.ExpressionAttributeValues[':prefix']||r.SK?.startsWith(q.ExpressionAttributeValues[':prefix']))).map(([,r])=>structuredClone(r));return f.queryOverride?f.queryOverride(command,rows):{Items:rows};
  }const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');if(command.constructor.name==='GetCommand'){const q={...command.input};if(q.ProjectionExpression&&!q.ExpressionAttributeNames)q.ExpressionAttributeNames=Object.fromEntries(q.ProjectionExpression.split(',').map(k=>[k.trim(),k.trim()]));return base(new GetCommand(q));}if(command.constructor.name==='TransactWriteCommand')return base(new TransactWriteCommand(command.input));return base(command);
 };
 Object.assign(f.get('WhizzMerchants_Businesses',{businessId:'branch1'}),{regionId:'zone1',isActive:true});
 await f.create();const send=f.db.send;f.db.send=async command=>{if(command.input.TransactItems?.some(op=>op.Put?.TableName==='WaveOffers_staging'))throw Error('synthetic offer unavailable');return send(command);};
 try{await f.execute();}catch(error){if(error.code!=='DRIVER_OFFER_SAVE_UNAVAILABLE')throw error;}f.db.send=send;
 f.time+=61000;await f.coordinator.plan({orderId:'order1',assignmentId:'dispatch1',source:'TIMEOUT'});
 const actor={pk:'EMPLOYEE#eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',sk:'PROFILE',employeeId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',username:'staff-test',status:'ACTIVE',version:1,roles:['operations'],scope:{allRegions:false,regionIds:['zone1']}};f.put('staging-PlatformStaff',actor);
 f.actor=()=>f.get('staging-PlatformStaff',{pk:actor.pk,sk:actor.sk});
 f.live={Enabled:true,UserStatus:'CONFIRMED',UserMFASettingList:['SOFTWARE_TOKEN_MFA'],UserAttributes:[{Name:'sub',Value:actor.employeeId}]};
 f.cognito={send:async()=>structuredClone(f.live)};
 const ctx={db:f.db,table:'staging-PlatformStaff',mode:'REQUESTS_ONLY',employee:async()=>f.actor(),guard:a=>exactCheck('staging-PlatformStaff',{pk:a.pk,sk:a.sk},a),enrolled:true,recent:()=>{},claims:{},audit:(id,action,before,after,ref)=>({Put:{TableName:'staging-PlatformStaff',Item:{pk:'AUDIT',sk:ref,actorId:id,action,before,after},ConditionExpression:'attribute_not_exists(pk)'}})};
 const selector={orderId:'order1',source:'SEARCH'},{item}=await route({...ctx,query:selector},f.actor(),'GET',PATH);
 await route(ctx,f.actor(),'POST',PATH+'/decisions',{selector,action:'RETRY_SEARCH',baseDigest:item.baseDigest,requestId:'11111111-1111-4111-8111-111111111111',reason:'اختبار استعادة البحث الممول'});
 f.decision=()=>[...f.rows.values()].find(r=>r.kind==='DISPATCH_REVIEW_DECISION');f.decision().createdAt=new Date(f.time).toISOString();
 f.retry=()=>createStagingDispatchReviewExecutor({db:f.db,cognito:f.cognito,now:()=>f.time,mode:'SAFE_FINANCIAL_INITIAL_RETRY'}).process(f.decision().caseId);
 f.queue=()=>[...f.rows.values()].find(r=>r.kind==='DISPATCH_RESTART_START');
 f.callback=s=>f.executor.run({orderId:s.orderId,assignmentId:s.assignmentId,owner:'retryworker',leaseSeconds:10});
 f.start=()=>createStagingDispatchRestartStart({db:f.db,now:()=>f.time,mode:'REQUIRED',engine:'FINANCIAL',start:s=>f.callback(s)}).process('order1',f.queue().restartId,'retryhost');
 return f;
}
module.exports={fixture};
