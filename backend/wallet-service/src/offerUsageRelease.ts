import {GetCommand} from '@aws-sdk/lib-dynamodb';
type Row=Record<string,any>;
const JOURNEY='staging-WizzOfferJourney';
const fail=():never=>{throw Object.assign(Error('OFFER_USAGE_REVIEW_REQUIRED'),{code:'OFFER_USAGE_REVIEW_REQUIRED',statusCode:409});};
const positive=(v:any)=>Number.isSafeInteger(v)&&v>0;
const id=(v:any)=>typeof v==='string'&&v.length>0&&v.length<=150;
export const offerAcceptanceFields=['confirmedAt','merchantAcceptedAt','acceptedAt','preparingAt','financialAcceptance'];
/** Caller must apply this fence to the order mutation in the SAME transaction. */
export function offerUsageOrderFence(row:Row){
 const names:Row={},values:Row={},parts:string[]=[];
 [...new Set([...Object.keys(row),...offerAcceptanceFields,'offerUsageReservation','offerUsageRelease'])].forEach((key,i)=>{
  const n='#ou'+i,v=':ou'+i;names[n]=key;
  if(row[key]===undefined)parts.push('attribute_not_exists('+n+')');
  else{values[v]=row[key];parts.push(n+'='+v);}
 });
 const condition=parts.join(' AND ');if(Buffer.byteLength(condition)>3900)fail();
 return {ConditionExpression:condition,ExpressionAttributeNames:names,ExpressionAttributeValues:values};
}
/** No writes. Restore only recorded reservations for pending, never-accepted orders.
 * Legacy orders without proof are left unchanged for a separate historical audit. */
export async function prepareOfferUsageRelease(db:{send:(command:any)=>Promise<any>},order:Row,at:string){
 const operations:Row[]=[],fields:Row={};
 if(order.status!=='pending'||offerAcceptanceFields.some(k=>order[k]!=null)||order.offerUsageRelease!=null)return {operations,fields};
 const proof=order.offerUsageReservation;if(proof==null)return {operations,fields};
 if(proof.schemaVersion!==1||typeof proof.accountReserved!=='boolean'||typeof proof.customerReserved!=='boolean'||
  proof.userSub!==order.userSub||proof.accountReserved&&!id(proof.userSub)||proof.customerReserved&&(!proof.accountReserved||!proof.campaign))fail();
 const read=async(table:string,key:Row)=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 const decrement=async(key:Row,account=false)=>{
  const row=await read(JOURNEY,key);if(!row||!positive(row.count)||!positive(row.version)||row.version>=Number.MAX_SAFE_INTEGER)fail();
  operations.push({Put:{TableName:JOURNEY,Item:{...row,count:row.count-1,version:row.version+1,...(account?{historyRequired:true}:{})},
   ...offerUsageOrderFence(row)}});
 };
 if(proof.accountReserved)await decrement({pk:'USER#'+proof.userSub,sk:'ORDERS'},true);
 if(proof.campaign){
  const c=proof.campaign,snapshot=order.offerSnapshot;
  if(!id(c.id)||!['MERCHANT','PLATFORM'].includes(c.source)||snapshot?.discountId!==c.id||snapshot?.source!==c.source)fail();
  const table=c.source==='MERCHANT'?'WhizzMerchants_Discounts':'WizzCentral_Platform_Discounts',key={discountId:c.id};
  const row=await read(table,key);
  if(!row)operations.push({ConditionCheck:{TableName:table,Key:key,ConditionExpression:'attribute_not_exists(discountId)'}});
  else {
   if(c.source==='MERCHANT'&&row.businessId!==order.storeId)fail();
   // A deleted/recreated campaign is a different reservation owner.
   if((row.createdAt??row.created_at??null)!==c.createdAt)operations.push({ConditionCheck:{TableName:table,Key:key,...offerUsageOrderFence(row)}});
   else {
    const counters=c.source==='PLATFORM'?['usage','currentUsage']:['usage_count',...(row.usageCount!==undefined?['usageCount']:[])];
    const count=row[counters[0]];if(!positive(count)||counters.some(k=>row[k]!==count))fail();
    operations.push({Put:{TableName:table,Item:{...row,...Object.fromEntries(counters.map(k=>[k,count-1]))},...offerUsageOrderFence(row)}});
   }
  }
  if(proof.customerReserved)await decrement({pk:'USER#'+proof.userSub,sk:'OFFER#'+c.source.toLowerCase()+'#'+c.id});
 }
 fields.offerUsageRelease={schemaVersion:1,policy:'BEFORE_MERCHANT_ACCEPTANCE',releasedAt:at};
 return {operations,fields};
}
