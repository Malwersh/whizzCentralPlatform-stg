'use strict';
const m=require('./model');
const TABLES={base:'WizzCentral_Regions',derived:'WizzCentral_RegionsDerived_staging',index:'WizzCentral_RegionIndex_staging',neighbors:'WizzCentral_RegionNeighbors_staging',audit:'WizzCentral_RegionAudit_staging'};
const JOB_PK='REGIONS_PUBLICATION#312';
function create({db,sdk,table=process.env.STAFF_TABLE}){
 const get=async(TableName,Key)=>(await db.send(new sdk.GetCommand({TableName,Key,ConsistentRead:true}))).Item;
 async function scan(TableName){let rows=[],cursor;do{const page=await db.send(new sdk.ScanCommand({TableName,ConsistentRead:true,ExclusiveStartKey:cursor}));rows.push(...page.Items||[]);cursor=page.LastEvaluatedKey;if(rows.length>1000||Buffer.byteLength(JSON.stringify(rows))>15000000)throw m.fail('REGION_CATALOG_CAPACITY',503);}while(cursor);return rows;}
 async function query(pk,prefix){let rows=[],cursor;do{const result=await db.send(new sdk.QueryCommand({TableName:table,KeyConditionExpression:'pk=:pk'+(prefix?' AND begins_with(sk,:prefix)':''),ExpressionAttributeValues:{':pk':pk,...(prefix?{':prefix':prefix}:{})},ConsistentRead:true,ExclusiveStartKey:cursor,Limit:100}));rows.push(...result.Items||[]);cursor=result.LastEvaluatedKey;if(rows.length>500)throw m.fail('REGION_HISTORY_CAPACITY',503);}while(cursor);return rows;}
 function fence(TableName,Key,row,fields){const names={},values={},terms=[];fields.forEach((f,i)=>{names['#f'+i]=f;if(row?.[f]===undefined)terms.push('attribute_not_exists(#f'+i+')');else{values[':v'+i]=row[f];terms.push('#f'+i+'=:v'+i);}});return {ConditionCheck:{TableName,Key,ConditionExpression:terms.join(' AND '),ExpressionAttributeNames:names,...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})}};}
 async function transaction(items){if(items.some(op=>op.Put&&Buffer.byteLength(JSON.stringify(op.Put.Item))>370000))throw m.fail('REGION_RECORD_CAPACITY',409);if(items.length>100||Buffer.byteLength(JSON.stringify(items))>3500000)throw m.fail('REGION_PUBLICATION_BATCH_LIMIT',409);try{await db.send(new sdk.TransactWriteCommand({TransactItems:items}));}catch(error){if(['TransactionCanceledException','ConditionalCheckFailedException'].includes(error.name))throw m.fail('REGION_VERSION_CONFLICT',409);throw error;}}
 const draftKey=(actor,id)=>({pk:'REGIONS_PLAN#'+actor,sk:'DRAFT#'+id});
 const versionKey=(actor,id,version)=>({pk:'REGIONS_PLAN#'+actor,sk:'VERSION#'+id+'#'+version});
 const jobKey=id=>({pk:'REGION_JOB#'+id,sk:'META'});
 const queueKey=id=>({pk:JOB_PK,sk:id});
 const historyKey=(actor,at,id)=>({pk:'REGIONS_HISTORY#'+actor,sk:at+'#'+id});
 const recent=async pk=>(await db.send(new sdk.QueryCommand({TableName:table,KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':pk},ConsistentRead:true,ScanIndexForward:false,Limit:15}))).Items||[];
 return {db,sdk,table,get,scan,query,fence,transaction,draftKey,versionKey,jobKey,queueKey,historyKey,recent,async catalog(){const [base,derived]=await Promise.all([scan(TABLES.base),scan(TABLES.derived)]);return {base,derived,digest:m.catalogDigest(base)};},drafts:actor=>query('REGIONS_PLAN#'+actor,'DRAFT#'),job:id=>get(table,jobKey(id))};
}
module.exports={TABLES,JOB_PK,create};
