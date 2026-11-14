'use strict';
// Real role authorization check. Two contradictory conditions guarantee transaction abort.
// No balance reads, funding, ledger entries, quotes or holds may be committed.
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
exports.handler=async event=>{
 if(process.env.STAGE!=='staging'||event?.probeId!==process.env.PROBE_ID||!/^[a-f0-9]{32}$/.test(event.probeId))throw Error('INVALID_WRITER_PROBE');
 const client=new DynamoDBClient({region:'us-east-1',maxAttempts:1}),db=DynamoDBDocumentClient.from(client);const id='finance58-'+event.probeId;
 try{
  const missing=[['staging-MerchantPlatform',{pk:'COMMERCIAL_AGREEMENT#'+id,sk:'VERSION#1'}],['staging-MerchantPlatform',{pk:'PERSON#'+id,sk:'ORGANIZATION#'+id}],['staging-PlatformStaff',{pk:'COMMERCIAL_AGREEMENT#'+id,sk:'APPROVAL#1'}],['staging-PlatformStaff',{pk:'DISCOUNT_FUNDING#'+id,sk:'CURRENT'}],['staging-DeliveryQuotes',{pk:'CUSTOMER#'+id,sk:'QUOTE#'+id}]];
  for(const [TableName,Key] of missing){const r=await db.send(new GetCommand({TableName,Key,ConsistentRead:true}));if(r.Item)throw Error('SYNTHETIC_KEY_COLLISION');}
  const platform={walletId:'WALLET#PLATFORM',sk:'META'};
  await db.send(new GetCommand({TableName:'staging-Wallets',Key:platform,ConsistentRead:true,ProjectionExpression:'walletId,sk'}));
  const contradiction='#w = :same AND #w <> :same';
  const update={Update:{TableName:'staging-Wallets',Key:platform,UpdateExpression:'SET #s=if_not_exists(#s,:state)',ConditionExpression:contradiction,ExpressionAttributeNames:{'#w':'walletId','#s':'status'},ExpressionAttributeValues:{':same':'WALLET#PLATFORM',':state':'ACTIVE'}}};
  const quote={Update:{TableName:'staging-DeliveryQuotes',Key:missing[4][1],UpdateExpression:'SET #s=:state',ConditionExpression:'attribute_exists(pk) AND attribute_not_exists(pk)',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':state':'SYNTHETIC_NEVER_COMMITTED'}}};
  const put=(table,Item)=>({Put:{TableName:table,Item,ConditionExpression:'attribute_not_exists(sk)'}});
  const tx=[update,quote,
   put('staging-Holds',{orderId:id,sk:'PROMOTION_FUNDING',purpose:'SYNTHETIC_NEVER_COMMITTED'}),
   put('staging-LedgerEntries',{walletId:'WALLET#PLATFORM',sk:'PROBE58#'+id,purpose:'SYNTHETIC_NEVER_COMMITTED'}),
   put('staging-AuditLog',{logId:'PROMO#'+id,datePartition:'SYNTHETIC58#'+id,sk:'PROBE58#'+id,purpose:'SYNTHETIC_NEVER_COMMITTED'}),
   ...missing.slice(0,4).map(([TableName,Key])=>({ConditionCheck:{TableName,Key,ConditionExpression:'attribute_not_exists(pk)'}}))];
  let reasons;
  try{await db.send(new TransactWriteCommand({TransactItems:tx}));throw Error('CONTRADICTORY_TRANSACTION_COMMITTED');}
  catch(e){if(e.name!=='TransactionCanceledException')throw e;reasons=e.CancellationReasons?.map(x=>x.Code);if(reasons?.length!==tx.length||reasons[0]!=='ConditionalCheckFailed'||reasons[1]!=='ConditionalCheckFailed'||reasons.slice(2).some(x=>x!=='None'))throw Error('UNEXPECTED_AUTHORIZATION_OR_CONDITION_FAILURE');}
  return {ok:true,projectedWalletIdentityOnly:true,syntheticSourcesRead:missing.length,authorizedAtomicOperations:tx.length,contradictoryConditionsRejected:true,applicationRowsWritten:0,balancesRead:false,providerCalls:0};
 }finally{client.destroy();}
};
