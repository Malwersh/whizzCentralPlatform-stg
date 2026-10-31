'use strict';
const {QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {digest}=require('./commercial-retention');
const {error}=require('./policy');
const table='staging-MerchantPlatform';
async function settlementCollectionInventory({db,branchId,maxPages=30}){
 const items=[];
 for(const prefix of ['MERCHANT_ACCRUAL#','MERCHANT_COLLECTION#']){
  let cursor;
  for(let page=0;page<maxPages;page++){
   const out=await db.send(new QueryCommand({TableName:table,ConsistentRead:true,Limit:100,KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':prefix+branchId},...(cursor?{ExclusiveStartKey:cursor}:{})}));
   for(const row of out.Items||[]){
    const invalid=()=>{throw error('SETTLEMENT_COLLECTION_RETENTION_INVALID');};
    const privateData=v=>v&&typeof v==='object'&&Object.entries(v).some(([k,x])=>/phone|email|address|customerName|latitude|longitude|photo|instructions/i.test(k)||privateData(x));
    if(privateData(row))invalid();
    if(row.pk!==prefix+branchId||row.branchId!==branchId||row.schemaVersion!==1||typeof row.sk!=='string'||row.expiresAt!==undefined||row.ttl!==undefined||Buffer.byteLength(JSON.stringify(row))>350000)invalid();
    if(prefix==='MERCHANT_ACCRUAL#'){
     if(row.kind==='MERCHANT_ACCRUAL_INDEX_HEAD'){
      if(!/^(HEAD|NODE#[1-9]#[0-9]+)$/.test(row.sk)||!Number.isSafeInteger(row.revision)||row.revision<1||row.retentionClass!=='FINANCIAL_SETTLEMENT')invalid();
     }else if(row.kind==='MERCHANT_ACCRUAL_INDEX_ENTRY'){
      const {pk,sk,digest:hash,...body}=row;
      if(digest(body)!==hash||sk!=='DELIVERED#'+row.deliveredAt+'#'+row.orderId||!Number.isSafeInteger(row.merchantNetIqd)||row.merchantNetIqd<0)invalid();
     }else invalid();
    }else{
     const {digest:hash,...body}=row;
     const kinds={MERCHANT_PERIOD_COLLECTION:'COLLECTION#',MERCHANT_COLLECTION_LOOKUP:'LIST#',MERCHANT_COLLECTION_PAGE:'PAGE#',MERCHANT_COLLECTION_PART:'PART#'};
     if(!kinds[row.kind]||!row.sk.startsWith(kinds[row.kind])||digest(body)!==hash||!/^MCG:[a-f0-9]{48}$/.test(row.collectionId||''))invalid();
    }
    items.push({table,row});
   }
   cursor=out.LastEvaluatedKey;if(!cursor)break;if(page===maxPages-1)throw error('SETTLEMENT_INVENTORY_INCOMPLETE');
  }
 }
 return items;
}
module.exports={settlementCollectionInventory};
