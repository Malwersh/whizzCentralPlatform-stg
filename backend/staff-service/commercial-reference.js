'use strict';
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const P='staging-MerchantPlatform',S='staging-PlatformStaff';
const COUNTER={pk:'SYSTEM_COUNTER#COMMERCIAL_SUPPORT',sk:'CURRENT'};
const valid=v=>typeof v==='string'&&/^AG-[0-9]{6,16}$/.test(v);
// The alias lives on the existing branch index, so existing branch cleanup removes it.
// The counter contains no person/branch identifiers and must never be reset or reused.
async function reference(ctx,draft,guards){
 for(let attempt=0;attempt<5;attempt++){
  const indexes=[];
  for(const businessId of [...draft.businessIds].sort()){
   const key={pk:'BRANCH#'+businessId,sk:'COMMERCIAL#AGREEMENT#'+draft.id};
   const row=(await ctx.db.send(new GetCommand({TableName:P,Key:key,ConsistentRead:true}))).Item;
   if(!row)continue;
   if(row.kind!=='AGREEMENT'||row.recordPk!=='COMMERCIAL_AGREEMENT#'+draft.id||row.ownerId!==draft.ownerId)throw Object.assign(Error('COMMERCIAL_REFERENCE_UNAVAILABLE'),{status:409});
   indexes.push(row);
  }
  if(!indexes.length)throw Object.assign(Error('COMMERCIAL_REFERENCE_UNAVAILABLE'),{status:409});
  const existing=[...new Set(indexes.filter(row=>row.supportReference!==undefined).map(row=>row.supportReference))];
  if(existing.length){if(existing.length!==1||!valid(existing[0]))throw Object.assign(Error('COMMERCIAL_REFERENCE_UNAVAILABLE'),{status:409});return existing[0];}
  const previous=(await ctx.db.send(new GetCommand({TableName:S,Key:COUNTER,ConsistentRead:true}))).Item;
  if(previous&&(!Number.isSafeInteger(previous.value)||previous.value<1||previous.value>=Number.MAX_SAFE_INTEGER))throw Object.assign(Error('COMMERCIAL_REFERENCE_UNAVAILABLE'),{status:409});
  const value=(previous?.value||0)+1,supportReference='AG-'+String(value).padStart(6,'0');
  try{
   await ctx.db.send(new TransactWriteCommand({TransactItems:[...guards,
    {Put:{TableName:S,Item:{...COUNTER,value},ConditionExpression:previous?'#n=:old':'attribute_not_exists(pk)',...(previous?{ExpressionAttributeNames:{'#n':'value'},ExpressionAttributeValues:{':old':previous.value}}:{})}},
    ...indexes.map(row=>({Put:{TableName:P,Item:{...row,supportReference},ConditionExpression:'attribute_exists(pk) AND attribute_not_exists(#ref) AND #owner=:owner AND #record=:record',ExpressionAttributeNames:{'#ref':'supportReference','#owner':'ownerId','#record':'recordPk'},ExpressionAttributeValues:{':owner':draft.ownerId,':record':row.recordPk}}}))
   ]}));return supportReference;
  }catch(e){if(e.name!=='TransactionCanceledException')throw e;}
 }
 throw Object.assign(Error('COMMERCIAL_REFERENCE_UNAVAILABLE'),{status:409});
}
module.exports={reference,valid,COUNTER};
