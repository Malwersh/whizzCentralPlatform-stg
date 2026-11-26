'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRequestService,TABLES}=require('./request-service.cjs');
class GetCommand{constructor(input){this.input=input;}}
class QueryCommand{constructor(input){this.input=input;}}
class TransactWriteCommand{constructor(input){this.input=input;}}
function fixture(){
 const rows=new Map(),transactions=[];
 const key=(table,k)=>JSON.stringify([table,k.pk,k.sk]);
 const seed=(table,row)=>rows.set(key(table,row),structuredClone(row));
 const read=(table,k)=>structuredClone(rows.get(key(table,k)));
 seed(TABLES.platform,{pk:'PERSON#owner',sk:'PROFILE',phoneNumber:'+9647800868280'});
 const values={types:[{id:'RESTAURANT',model:'FOOD',registrationOpen:true,regions:[],fields:[]}],partnershipReady:true,termsVersion:'agreement-1',termsTextAr:'اتفاقية معتمدة'};
 seed(TABLES.policy,{pk:'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',sk:'CURRENT',policyVersion:2,values});
 seed(TABLES.policy,{pk:'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',sk:'VERSION#2',values});
 const db={send:async command=>{
  const q=command.input;
  if(command instanceof GetCommand)return {Item:read(q.TableName,q.Key)};
  if(command instanceof QueryCommand)return {Items:[...rows.values()].filter(r=>r.pk===q.ExpressionAttributeValues[':pk']&&r.sk.startsWith(q.ExpressionAttributeValues[':prefix'])).map(row=>structuredClone(row))};
  assert.ok(command instanceof TransactWriteCommand);
  // Evaluate optimistic version and lifecycle fences before committing any row.
  for(const operation of q.TransactItems){
   const op=operation.Put||operation.ConditionCheck,current=read(op.TableName,op.Key||op.Item);
   const condition=op.ConditionExpression;
   const conflict=condition==='attribute_not_exists(pk)'?!!current:condition==='#v=:v'?current?.version!==op.ExpressionAttributeValues[':v']:condition==='policyVersion=:v'?current?.policyVersion!==op.ExpressionAttributeValues[':v']:true;
   if(conflict)throw Object.assign(Error('conflict'),{name:'TransactionCanceledException'});
  }
  transactions.push(structuredClone(q.TransactItems));
  for(const op of q.TransactItems)if(op.Put)seed(op.Put.TableName,op.Put.Item);
  return {};
 }};
 const run=createRequestService({db,sdk:{GetCommand,QueryCommand,TransactWriteCommand},regions:{list:async()=>({items:[]}),validate:async(_db,path)=>({regionId:path[3],regionNames:['العراق','النجف','المناذرة','المركز'],checks:[]})},authenticate:async event=>{
  const sub=event.testSubject||'owner';return {sub,user:{Enabled:true,UserStatus:'CONFIRMED',UserAttributes:[{Name:'sub',Value:sub},{Name:'phone_number_verified',Value:'true'},{Name:'phone_number',Value:'+9647800868280'}]}};
 }});
 const call=(path,body,extra={})=>run({path:'/auth/branch-drafts'+path,httpMethod:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)}),...extra});
 return {call,seed,read,transactions};
}
test('verified branch journey saves, edits, pins agreement and submits once without activation',async()=>{
 const f=fixture();
 const {draft:first}=await f.call('',{name:'مطعم جديد',businessTypeId:'RESTAURANT'});
 assert.equal(first.version,1);assert.equal(first.operatingStatus,'OFFLINE');
 const openingHours=Array.from({length:7},(_,day)=>({day,closed:false,periods:[{open:'09:00',close:'22:00'}]}));
 const {draft:edited}=await f.call('',{draftId:first.draftId,baseVersion:1,name:'مطعم جديد',businessTypeId:'RESTAURANT',address:'حي الجمعية',regionPath:['iq','najaf','district','leaf'],latitude:31.9,longitude:44.4,openingHours});
 assert.equal(edited.version,2);
 const terms=await f.call('/config',undefined,{queryStringParameters:{draftId:first.draftId}});
 assert.equal(terms.agreementVersion,'agreement-1');
 const input={draftId:first.draftId,baseVersion:2,agreementVersion:terms.agreementVersion};
 const {draft:submitted}=await f.call('/submit',input);
 assert.equal(submitted.reviewStatus,'SUBMITTED');assert.equal(submitted.operatingStatus,'OFFLINE');
 assert.equal(submitted.submission.snapshot.address,'حي الجمعية');
 assert.equal(submitted.submission.agreement.textAr,'اتفاقية معتمدة');
 const count=f.transactions.length;
 assert.deepEqual(await f.call('/submit',input),{draft:submitted});
 assert.equal(f.transactions.length,count,'retry must not create another review request');
 assert.equal(f.transactions.flat().filter(op=>op.Put?.Item.pk==='REVIEW#MERCHANT').length,1);
 assert.ok(f.transactions.flat().every(op=>!op.Put||op.Put.TableName===TABLES.platform));
 assert.ok(!JSON.stringify(f.transactions).includes('WALLET#'));
 await assert.rejects(()=>f.call('',{...edited,baseVersion:3}),/UNKNOWN_FIELD/);
});
test('another owner cannot list or submit a draft; stale edits leave saved data intact',async()=>{
 const f=fixture(),input={name:'مطعم',businessTypeId:'RESTAURANT'};
 const {draft}=await f.call('',input);
 assert.deepEqual(await f.call('',undefined,{testSubject:'other'}),{items:[]});
 await assert.rejects(()=>f.call('/submit',{draftId:draft.draftId,baseVersion:1,agreementVersion:'agreement-1'},{testSubject:'other'}),/DRAFT_NOT_FOUND/);
 await f.call('',{...input,draftId:draft.draftId,baseVersion:1,name:'الاسم المعدل'});
 await assert.rejects(()=>f.call('',{...input,draftId:draft.draftId,baseVersion:1}),/VERSION_OR_STATE_CONFLICT/);
 assert.equal(f.read(TABLES.platform,{pk:'PERSON#owner',sk:'DRAFT#'+draft.draftId}).name,'الاسم المعدل');
 assert.equal(f.transactions.length,2);
});
test('account closure blocks subsequent edits without changing a saved draft',async()=>{
 const f=fixture(),input={name:'مطعم',businessTypeId:'RESTAURANT'};
 const {draft}=await f.call('',input);
 f.seed(TABLES.lifecycle,{pk:'ACCOUNT_LIFECYCLE#MERCHANT#owner',sk:'META',status:'REQUESTED'});
 await assert.rejects(()=>f.call('',{...input,draftId:draft.draftId,baseVersion:1,name:'تغيير'}),/ACCOUNT_CLOSING/);
 assert.equal(f.transactions.length,1);
 assert.equal(f.read(TABLES.platform,{pk:'PERSON#owner',sk:'DRAFT#'+draft.draftId}).version,1);
});
