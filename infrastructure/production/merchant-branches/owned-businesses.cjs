'use strict';
const TABLE='wizz-production-Merchants';
// The index selects candidates only. Strong base-table reads establish current ownership.
async function listOwnedBusinesses({db,sdk,sub}){
 if(typeof sub!=='string'||!sub)throw Error('AUTHENTICATED_SUBJECT_REQUIRED');
 const businesses=[],seen=new Set();let cursor;
 do{
  const page=await db.send(new sdk.QueryCommand({TableName:TABLE,IndexName:'ownerId-index',KeyConditionExpression:'ownerId=:owner',ExpressionAttributeValues:{':owner':sub},ProjectionExpression:'businessId',ExclusiveStartKey:cursor}));
  for(const candidate of page.Items||[]){
   const id=candidate.businessId;
   if(typeof id!=='string'||!id||seen.has(id))continue;
   seen.add(id);
   const b=(await db.send(new sdk.GetCommand({TableName:TABLE,Key:{businessId:id},ConsistentRead:true}))).Item;
   if(!b||b.ownerId!==sub||b.cognitoUserId!==sub||b.deletionRequestId||b.deletedAt||b.isDeleted||b.status==='DELETED')continue;
   // Owner screen summary only; never serialize private documents, financial fields or tokens.
   const summary={};
   for(const key of ['businessId','businessName','name','status','businessType','businessTypeId','regionId','logoUrl','imageUrl','address','createdAt','updatedAt'])if(b[key]!==undefined)summary[key]=b[key];
   businesses.push(summary);
  }
  cursor=page.LastEvaluatedKey;
 }while(cursor);
 // A deletion request arriving during the read must also stop the response.
 const life=await db.send(new sdk.GetCommand({TableName:'wizz-production-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+sub,sk:'META'},ConsistentRead:true}));
 if(life.Item)throw Object.assign(Error('ACCOUNT_CLOSING'),{code:'ACCOUNT_CLOSING',status:403});
 return {success:true,businesses};
}
module.exports={listOwnedBusinesses};
