'use strict';
const {ScanCommand,DeleteCommand}=require('@aws-sdk/lib-dynamodb');
const TABLE='staging-MerchantPlatform';
const epoch=v=>Number.isSafeInteger(v)&&v>0;
function eligible(row,at){
 if(!row||!epoch(at)||!epoch(row.ttl)||row.ttl>at||!epoch(row.version)||row.legalHold||row.retentionHold)return false;
 if(/^MERCHANT_FINANCIAL_SESSION#[a-f0-9]{64}$/.test(row.pk||'')){
  const kind=row.sk==='SESSION'?'MERCHANT_FINANCIAL_SESSION':row.sk==='CHALLENGE'?'MERCHANT_FINANCIAL_CHALLENGE':null;
  return !!kind&&row.kind===kind&&Number.isSafeInteger(row.expiresAt)&&row.expiresAt>=0&&row.expiresAt<=at&&row.expiresAt<=row.ttl;
 }
 return /^MERCHANT_FINANCIAL_RATE#[a-f0-9]{64}$/.test(row.pk||'')&&row.sk==='OTP'&&epoch(row.sentAt)&&epoch(row.windowStart)&&row.windowStart<=row.sentAt&&row.sentAt<row.ttl&&epoch(row.sentCount);
}
async function sweep({db,now=Date.now,dryRun=true,cursor,maxPages=4,maxDeletes=25,remainingTime=()=>300000}){
 if(typeof dryRun!=='boolean'||!Number.isInteger(maxPages)||maxPages<1||maxPages>20||!Number.isInteger(maxDeletes)||maxDeletes<1||maxDeletes>100)throw Error('INVALID_SECURITY_RETENTION_REQUEST');
 if(cursor&&!(typeof cursor.pk==='string'&&typeof cursor.sk==='string'&&Object.keys(cursor).length===2))throw Error('INVALID_SECURITY_RETENTION_CURSOR');
 const at=Math.floor(now()/1000);let pages=0,examined=0,candidates=0,deleted=0,changed=0,timedOut=false;
 do{
  if(remainingTime()<30000){timedOut=true;break;}
  const page=await db.send(new ScanCommand({TableName:TABLE,ConsistentRead:true,Limit:100,ExclusiveStartKey:cursor}));pages++;
  const items=page.Items||[];let stopped=false;
  for(let i=0;i<items.length;i++){
   const row=items[i];examined++;
   if(!eligible(row,at))continue;candidates++;
   if(!dryRun){
    const names={'#v':'version'},values={':v':row.version,':ttl':row.ttl,':no':false};let condition='#v=:v AND ttl=:ttl AND (attribute_not_exists(legalHold) OR legalHold=:no) AND (attribute_not_exists(retentionHold) OR retentionHold=:no)';
    if(row.sk==='OTP'){for(const field of ['sentAt','windowStart','sentCount']){condition+=' AND '+field+'=:'+field;values[':'+field]=row[field];}}
    else{names['#kind']='kind';condition+=' AND #kind=:kind AND expiresAt=:expires';values[':kind']=row.kind;values[':expires']=row.expiresAt;}
    try{await db.send(new DeleteCommand({TableName:TABLE,Key:{pk:row.pk,sk:row.sk},ConditionExpression:condition,ExpressionAttributeNames:names,ExpressionAttributeValues:values}));deleted++;}catch(e){if(e.name!=='ConditionalCheckFailedException')throw e;changed++;}
   }
   if(candidates>=maxDeletes||remainingTime()<30000){cursor=i<items.length-1?{pk:row.pk,sk:row.sk}:page.LastEvaluatedKey;stopped=true;break;}
  }
  if(stopped)break;cursor=page.LastEvaluatedKey;
 }while(cursor&&pages<maxPages);
 return {dryRun,pages,examined,candidates,deleted,changed,complete:!cursor&&!timedOut,...(cursor?{cursor}:{})};
}
module.exports={eligible,sweep};
