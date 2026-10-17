"use strict";
const {ScanCommand,GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const ARCHIVE='staging-AccountDeletionFinancialArchive';
const TABLES=[['staging-MerchantPlatform',['pk','sk'],'commercial_agreement'],['staging-PlatformStaff',['pk','sk'],'commercial_approval'],['staging-PlatformStaff',['pk','sk'],'commercial_funding'],['staging-PlatformStaff',['pk','sk'],'commercial_audit'],['staging-PlatformStaff',['pk','sk'],'cod_review'],['WizzDispatchJobs_staging',['orderId','SK'],'cod_dispatch'],['staging-Holds',['orderId','sk'],'cod_hold'],['staging-WalletLifecycle',['operationId'],'cod_event'],['WaveOffers_staging',['orderId','SK'],'cod_offer'],['staging-LedgerEntries',['walletId','sk'],'ledger'],['WizzUser_transactions_staging',['transactionId'],'payment'],['WizzOrders',['PK','SK'],'order'],['staging-IdempotencyKeys',['idempotencyKey','sk'],'transfer'],['staging-AuditLog',['datePartition','sk'],'audit'],['staging-TopupRequests',['topupId','sk'],'topup'],['staging-SandboxPayments',['pk','sk'],'sandbox']];
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
function sourceOf(row){
 if(!uuid(row.requestId)||row.pk!=='REQUEST#'+row.requestId||typeof row.sk!=='string'||!Number.isSafeInteger(row.expiresAt))throw error('PURGE_SCOPE_INVALID');
 const kind=row.kind?.startsWith('sandbox_')?'sandbox':row.kind;
 const spec=TABLES.find(s=>s[2]===kind);if(!spec)throw error('PURGE_SCOPE_INVALID');
 const prefix=String(row.kind).toUpperCase()+'#';if(!row.sk.startsWith(prefix))throw error('PURGE_SCOPE_INVALID');
 let key;try{key=JSON.parse(row.sk.slice(prefix.length));}catch(_){throw error('PURGE_SCOPE_INVALID');}
 if(Object.keys(key).length!==spec[1].length||spec[1].some(k=>typeof key[k]!=='string'||!key[k]))throw error('PURGE_SCOPE_INVALID');
 key=Object.fromEntries(spec[1].map(k=>[k,key[k]]));
 if(String(kind).startsWith('commercial_')&&require('./commercial-retention').kindFor(spec[0],key)!==kind)throw error('PURGE_SCOPE_INVALID');
 if(kind==='cod_review'&&(!/^DISPATCH_REVIEW#[a-f0-9]{64}$/.test(key.pk)||key.sk!=='DECISION'))throw error('PURGE_SCOPE_INVALID');
 if(row.sourceTable!==undefined&&row.sourceTable!==spec[0])throw error('PURGE_SCOPE_INVALID');
 if(row.sourceKey!==undefined&&(Object.keys(row.sourceKey).length!==spec[1].length||spec[1].some(k=>row.sourceKey[k]!==key[k])))throw error('PURGE_SCOPE_INVALID');
 return {table:spec[0],key,id:spec[0]+'#'+JSON.stringify(key)};
}
const held=r=>r.legalHold===true||r.retentionHold===true;
const noHolds='(attribute_not_exists(legalHold) OR legalHold = :no) AND (attribute_not_exists(retentionHold) OR retentionHold = :no)';
function financialPurge({db,clock=()=>Math.floor(Date.now()/1000),dryRun=true,maxPages=100,maxDeletes=100}){
 if(!Number.isSafeInteger(maxPages)||maxPages<1||!Number.isSafeInteger(maxDeletes)||maxDeletes<1)throw error('INVALID_PURGE_LIMIT');
 return async()=>{
  const groups=new Map();let cursor,pages=0,removed=0,archivesRemoved=0,eligible=0,blocked=0;
  // Complete inventory before deleting: a second deletion request may retain or hold the same source.
  do{
   if(pages++>=maxPages)return {removed,archivesRemoved,eligible,blocked,dryRun,incomplete:true};
   const res=await db.send(new ScanCommand({TableName:ARCHIVE,ConsistentRead:true,ExclusiveStartKey:cursor,Limit:100}));
   for(const a of res.Items||[]){const source=sourceOf(a);if(!groups.has(source.id))groups.set(source.id,{...source,archives:[]});groups.get(source.id).archives.push(a);}
   cursor=res.LastEvaluatedKey;
  }while(cursor);
  const now=clock();
  for(const g of groups.values()){
   if(g.archives.some(a=>held(a)||a.expiresAt>now)||g.archives.length>99){blocked++;continue;}
   const {Item:source}=await db.send(new GetCommand({TableName:g.table,Key:g.key,ConsistentRead:true}));
   const commercial=g.archives.every(a=>String(a.kind).startsWith('commercial_'));
   if(commercial&&source&&held(source)){blocked++;continue;}
   if(!commercial&&source&&(held(source)||source.financialArchiveConfirmed!==true||!Number.isSafeInteger(source.financialRetainUntil)||source.financialRetainUntil>now||!g.archives.some(a=>a.requestId===source.accountDeletionRequestId))){blocked++;continue;}
   const financialGuards=[];
   if(commercial){const guards=await require('./commercial-retention').commercialPurgeGuards({db,group:g,source});if(!guards||guards.length+g.archives.length+1>100){blocked++;continue;}financialGuards.push(...guards);}
   // Expiry must not erase proof of an unpaid merchant liability or unresolved return/compensation.
   // These sources are shared by parties with independent deletion requests and retention clocks.
   const codSource=g.archives.some(a=>String(a.kind).startsWith('cod_')||a.kind==='order'&&a.data?.codFinancialEvidence||a.data?.financialSchemaVersion===2||/^COD_/.test(a.data?.category||'')||/^COD_/.test(a.data?.action||'')||a.data?.action==='FINANCIAL_DRIVER_OFFER_ACCEPTED');
   if(codSource){
    const orderId=source?.orderId||g.archives[0].data?.orderId;
    if(typeof orderId!=='string'||!orderId){blocked++;continue;}
    const {Item:order}=await db.send(new GetCommand({TableName:'WizzOrders',Key:{PK:'ORDER#'+orderId,SK:'META'},ConsistentRead:true}));
    const {Item:payable}=await db.send(new GetCommand({TableName:'staging-Holds',Key:{orderId,sk:'MERCHANT_PAYABLE'},ConsistentRead:true}));
    const {Item:outcome}=await db.send(new GetCommand({TableName:'staging-Holds',Key:{orderId,sk:'FINANCIAL_OUTCOME'},ConsistentRead:true}));
    const pending=r=>r&&(r.driverCompensationStatus==='PENDING_POLICY_REVIEW'||r.receipt?.driverCompensationStatus==='PENDING_POLICY_REVIEW'||r.codFinancialEvidence?.receipt?.driverCompensationStatus==='PENDING_POLICY_REVIEW');
    if(source?.status==='ACTIVE'||[order,payable,outcome].some(r=>r&&held(r))||order&&!['delivered','completed','returned','cancelled','canceled'].includes(order.status)||payable&&payable.amount>0&&!['SETTLED','PAID'].includes(payable.status)||pending(outcome)||pending(source)){blocked++;continue;}
    for(const [table,key,row]of [['WizzOrders',{PK:'ORDER#'+orderId,SK:'META'},order],['staging-Holds',{orderId,sk:'MERCHANT_PAYABLE'},payable],['staging-Holds',{orderId,sk:'FINANCIAL_OUTCOME'},outcome]]){
     if(table===g.table&&JSON.stringify(key)===JSON.stringify(g.key))continue;
     const names={'#key':Object.keys(key)[0]},values={},parts=[];
     if(!row)parts.push('attribute_not_exists(#key)');else for(const [i,k]of ['status','amount','driverCompensationStatus','receipt','codFinancialEvidence','legalHold','retentionHold'].entries()){names['#f'+i]=k;if(row[k]===undefined)parts.push('attribute_not_exists(#f'+i+')');else{values[':f'+i]=row[k];parts.push('#f'+i+'=:f'+i);}}
     // #key is only used for absent rows.
     if(row)delete names['#key'];
     financialGuards.push({ConditionCheck:{TableName:table,Key:key,ConditionExpression:parts.join(' AND '),ExpressionAttributeNames:names,...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})}});
    }
    if(g.archives.length+1+financialGuards.length>100){blocked++;continue;}
   }
   eligible++;if(dryRun)continue;
   if(archivesRemoved+g.archives.length>maxDeletes)return {removed,archivesRemoved,eligible,blocked,dryRun,incomplete:true};
   const archiveDeletes=g.archives.map(a=>({Delete:{TableName:ARCHIVE,Key:{pk:a.pk,sk:a.sk},ConditionExpression:'requestId = :request AND expiresAt = :expiry AND '+noHolds,ExpressionAttributeValues:{':request':a.requestId,':expiry':a.expiresAt,':no':false}}}));
   if(commercial)for(let i=0;i<archiveDeletes.length;i++){const guard=require('./cod-retention').exact(g.archives[i]);Object.assign(archiveDeletes[i].Delete,guard);}
   const sourceOperation=source?{Delete:{TableName:g.table,Key:g.key,ConditionExpression:'accountDeletionRequestId = :request AND financialArchiveConfirmed = :yes AND financialRetainUntil = :until AND '+noHolds,ExpressionAttributeValues:{':request':source.accountDeletionRequestId,':yes':true,':until':source.financialRetainUntil,':no':false}}}:{ConditionCheck:{TableName:g.table,Key:g.key,ConditionExpression:'attribute_not_exists(#key)',ExpressionAttributeNames:{'#key':Object.keys(g.key)[0]}}};
   if((codSource||commercial)&&source){const guard=require('./cod-retention').exact(source);sourceOperation.Delete.ConditionExpression=guard.ConditionExpression;sourceOperation.Delete.ExpressionAttributeNames=guard.ExpressionAttributeNames;sourceOperation.Delete.ExpressionAttributeValues=guard.ExpressionAttributeValues;}
   try{await db.send(new TransactWriteCommand({TransactItems:[sourceOperation,...archiveDeletes,...financialGuards]}));removed+=source?1:0;archivesRemoved+=g.archives.length;}
   catch(e){if(e.name!=='TransactionCanceledException'||!e.CancellationReasons?.some(r=>r.Code==='ConditionalCheckFailed')||e.CancellationReasons.some(r=>!['None','ConditionalCheckFailed'].includes(r.Code)))throw e;blocked++;}
   if(archivesRemoved>=maxDeletes)return {removed,archivesRemoved,eligible,blocked,dryRun,incomplete:true};
  }
  return {removed,archivesRemoved,eligible,blocked,dryRun,incomplete:false};
 };
}
module.exports={financialPurge,TABLES,sourceOf};
module.exports.handler=async(event={})=>{
 if(process.env.ENVIRONMENT!=='staging')throw error('ENVIRONMENT_NOT_ALLOWED');
 const dryRun=event.dryRun!==false;
 if(!dryRun&&process.env.FINANCIAL_EXPIRY_ENABLED!=='true')throw error('FINANCIAL_EXPIRY_DISABLED');
 const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
 const {DynamoDBDocumentClient}=require('@aws-sdk/lib-dynamodb');
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
 return financialPurge({db,dryRun})();
};
