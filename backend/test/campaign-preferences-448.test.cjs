const {test}=require('node:test'),assert=require('node:assert/strict');
const {createWorker}=require('../src/handlers/campaign-push-worker');
async function run(disabledInitially,disabledAtDelivery){
 let sends=0,finished;const profile={userId:'u',isActive:true,notification_settings:{promotion_notifications:!disabledInitially}};
 const campaign={discountId:'offer',version:1,status:'active',validFrom:'2020-01-01',validTo:'2099-01-01'};
 const db={send:async c=>{const i=c.input,n=c.constructor.name;
  if(n==='ScanCommand')return {Items:i.TableName==='WizzUser_users_staging'?[profile]:[{app:'user',token:'token',subjectId:'u'}]};
  if(n==='GetCommand')return {Item:i.TableName==='WizzCentral_Platform_Discounts'?campaign:i.TableName==='WizzUser_users_staging'?{...profile,notification_settings:{promotion_notifications:!disabledAtDelivery}}:{status:'QUEUED',discountId:'offer',campaignVersion:1,title:'offer',body:'body'}};
  if(n==='UpdateCommand'&&i.ExpressionAttributeValues[':counts'])finished={status:i.ExpressionAttributeValues[':s'],...i.ExpressionAttributeValues[':counts']};
  return {};
 }};
 await createWorker({db,messaging:async()=>({send:async()=>{sends++;}}),eligible:async()=>true,customer:async()=>({})})('a'.repeat(64));
 return {sends,finished};
}
test('campaign does not send to customer with promotions off',async()=>{const r=await run(true,true);assert.equal(r.sends,0);assert.equal(r.finished.status,'NO_RECIPIENTS');});
test('preference changed after audience selection is checked before send',async()=>{const r=await run(false,true);assert.equal(r.sends,0);assert.equal(r.finished.targeted,0);assert.equal(r.finished.status,'NO_RECIPIENTS');});
test('enabled eligible customer still receives campaign',async()=>{const r=await run(false,false);assert.equal(r.sends,1);assert.equal(r.finished.status,'SENT');});
