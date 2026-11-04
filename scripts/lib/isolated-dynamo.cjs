'use strict';
// A disposable physical table executes the real application's DynamoDB expressions without touching app tables.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),rawSdk=require('@aws-sdk/client-dynamodb'),sdk=require('@aws-sdk/lib-dynamodb');
async function isolatedDynamo(prefix){
 assert(/^staging-[a-z0-9-]+-test-\d+$/.test(prefix));const table=prefix+'-'+randomUUID(),raw=new rawSdk.DynamoDBClient({region:'us-east-1'}),doc=sdk.DynamoDBDocumentClient.from(raw,{marshallOptions:{removeUndefinedValues:true}});let created=false,interfere=null;
 const key=(t,k)=>({_testPk:t+'|'+(k.pk||k.businessId||k.discountId||k.walletId),_testSk:k.sk||'META'}),keys=(t,r)=>key(t,r.pk?{pk:r.pk,sk:r.sk}:r.discountId?{discountId:r.discountId}:r.walletId?{walletId:r.walletId,sk:r.sk}:{businessId:r.businessId});
 const clean=r=>r?Object.fromEntries(Object.entries(r).filter(([k])=>!k.startsWith('_test'))):r;
 const get=async(t,k)=>clean((await doc.send(new sdk.GetCommand({TableName:table,Key:key(t,k),ConsistentRead:true}))).Item);
 const put=(t,r)=>doc.send(new sdk.PutCommand({TableName:table,Item:{...r,...keys(t,r)}}));
 async function wait(state){for(let n=0;n<50;n++){try{const r=await raw.send(new rawSdk.DescribeTableCommand({TableName:table}));if(state==='ACTIVE'&&r.Table.TableStatus==='ACTIVE')return;}catch(e){if(state==='DELETED'&&e.name==='ResourceNotFoundException')return;throw e;}await new Promise(r=>setTimeout(r,1000));}throw Error('TABLE_WAIT_TIMEOUT');}
 const db={async send(c){const x=c.input,kind=c.constructor.name;if(kind==='GetCommand')return {Item:await get(x.TableName,x.Key)};if(kind==='QueryCommand'){
  const prefix=x.ExpressionAttributeValues[':prefix']||x.ExpressionAttributeValues[':p']||'';const r=await doc.send(new sdk.QueryCommand({TableName:table,KeyConditionExpression:'#p=:p'+(prefix?' AND begins_with(#s,:s)':''),ExpressionAttributeNames:{'#p':'_testPk',...(prefix?{'#s':'_testSk'}:{})},ExpressionAttributeValues:{':p':x.TableName+'|'+x.ExpressionAttributeValues[':pk'],...(prefix?{':s':prefix}:{})},ConsistentRead:true,Limit:x.Limit,...(x.ExclusiveStartKey?{ExclusiveStartKey:x.ExclusiveStartKey}:{})}));return {Items:r.Items?.map(clean),LastEvaluatedKey:r.LastEvaluatedKey};
 }assert.equal(kind,'TransactWriteCommand');if(interfere){const f=interfere;interfere=null;await f(x);}
 return doc.send(new sdk.TransactWriteCommand({TransactItems:x.TransactItems.map(op=>{const [kind,v]=Object.entries(op)[0];return {[kind]:{...v,TableName:table,...(v.Key?{Key:key(v.TableName,v.Key)}:{Item:{...v.Item,...keys(v.TableName,v.Item)}})}};})}));}};
 try{await raw.send(new rawSdk.CreateTableCommand({TableName:table,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'_testPk',AttributeType:'S'},{AttributeName:'_testSk',AttributeType:'S'}],KeySchema:[{AttributeName:'_testPk',KeyType:'HASH'},{AttributeName:'_testSk',KeyType:'RANGE'}]}));created=true;await wait('ACTIVE');}catch(e){if(created)await raw.send(new rawSdk.DeleteTableCommand({TableName:table}));throw e;}
 return {table,db,get,put,interfere:f=>interfere=f,close:async()=>{if(created){await raw.send(new rawSdk.DeleteTableCommand({TableName:table}));await wait('DELETED');created=false;}},sdk};
}
module.exports={isolatedDynamo};
