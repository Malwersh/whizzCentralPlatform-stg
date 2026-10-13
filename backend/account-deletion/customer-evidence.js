'use strict';
const {GetCommand,QueryCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const TABLES={profiles:'WizzUser_users_staging',legacyWallets:'WizzUser_wallets_staging',wallets:'staging-Wallets',orders:'WizzOrders',holds:'staging-Holds',transfers:'staging-IdempotencyKeys'};
const finishedOrders=new Set(['delivered','completed','cancelled','canceled','rejected','refunded']);
const finishedTransfers=new Set(['COMPLETED','REJECTED','CANCELLED','CANCELED']);
function belongs(profile,actor){
 return profile.userId===actor.sub||profile.cognitoSub===actor.sub||profile.cognitoUsername===actor.username||(actor.attrs?.email_verified==='true'&&profile.email===actor.attrs.email&&profile.cognitoUsername===actor.attrs.email);
}
function customerEvidence({db,maxPages=100}){
 if(!db)throw error('EVIDENCE_UNAVAILABLE');
 async function pages(Command,input){
  let cursor,rows=[],count=0;
  do{const result=await db.send(new Command({...input,ExclusiveStartKey:cursor}));rows.push(...result.Items||[]);cursor=result.LastEvaluatedKey;if(++count>=maxPages&&cursor)throw error('EVIDENCE_INCOMPLETE');}while(cursor);
  return rows;
 }
 async function query(table,index,field,value){return pages(QueryCommand,{TableName:table,IndexName:index,KeyConditionExpression:'#field = :value',ExpressionAttributeNames:{'#field':field},ExpressionAttributeValues:{':value':value}});}
 async function scanOwned(table,fields,ids,extra){
  const names={},values={},markers=ids.map((id,i)=>{values[':id'+i]=id;return ':id'+i;});
  if(!ids.length)return [];
  const filter=fields.map((field,i)=>{names['#field'+i]=field;return '#field'+i+' IN ('+markers.join(',')+')';}).join(' OR ');
  const rows=await pages(ScanCommand,{TableName:table,ConsistentRead:true,FilterExpression:'('+filter+')',ExpressionAttributeNames:names,ExpressionAttributeValues:values});
  // Check returned ownership as well, rather than trusting a malformed index/provider result.
  if(rows.some(row=>!fields.some(f=>ids.includes(row[f]))))throw error('OWNERSHIP_MISMATCH');
  return extra?rows.filter(extra):rows;
 }
 return async actor=>{
  if(actor?.type!=='CUSTOMER'||typeof actor.sub!=='string'||!actor.sub||!actor.username)throw error('UNAUTHORIZED');
  const profiles=new Map();const canonical=(await db.send(new GetCommand({TableName:TABLES.profiles,Key:{userId:actor.sub},ConsistentRead:true}))).Item;
  if(canonical){if(!belongs(canonical,actor))throw error('OWNERSHIP_MISMATCH');profiles.set(canonical.userId,canonical);}
  // Verified Cognito email is only a lookup aid; each legacy profile needs its exact binding.
  if(actor.attrs?.email_verified==='true'&&actor.attrs.email){for(const row of await query(TABLES.profiles,'email-index','email',actor.attrs.email)){if(!belongs(row,actor))throw error('IDENTITY_AMBIGUOUS');profiles.set(row.userId,row);}}
  if(actor.attrs?.phone_number_verified==='true'&&/^\+9647\d{9}$/.test(actor.attrs.phone_number||'')){
   const phone=actor.attrs.phone_number;
   for(const value of [phone,'0'+phone.slice(4),phone.slice(4)])for(const row of await query(TABLES.profiles,'phone-index','phone',value)){
    if(!belongs(row,actor))throw error('IDENTITY_AMBIGUOUS');profiles.set(row.userId,row);
   }
  }
  if(!profiles.size)throw error('PROFILE_NOT_FOUND');
  const ids=[...new Set([actor.sub,...profiles.keys()])],wallets=[];
  const walletId='WALLET#CUSTOMER#'+actor.sub;
  const core=(await db.send(new GetCommand({TableName:TABLES.wallets,Key:{walletId,sk:'META'},ConsistentRead:true}))).Item;
  if(core){if(core.ownerType!=='CUSTOMER'||core.ownerId!==actor.sub||core.walletId!==walletId||core.currency!=='IQD'||!Number.isSafeInteger(core.version)||!Number.isSafeInteger(core.availableBalance)||!Number.isSafeInteger(core.lockedBalance))throw error('EVIDENCE_UNAVAILABLE');wallets.push({walletId,available:core.availableBalance,locked:core.lockedBalance,version:core.version,source:'CORE'});}
  const legacy=new Map();
  for(const id of ids)for(const row of await query(TABLES.legacyWallets,'userId-index','userId',id)){
   if(!ids.includes(row.userId)||!row.walletId||row.currency!=='IQD'||!Number.isSafeInteger(row.balance))throw error('EVIDENCE_UNAVAILABLE');
   legacy.set(row.walletId,{walletId:row.walletId,available:row.balance,locked:0,source:'ORDER_PAYMENT'});
  }
  wallets.push(...legacy.values());
  const walletIds=[...new Set([walletId,...wallets.map(w=>w.walletId)])];
  const orders=await scanOwned(TABLES.orders,['userId','customerId','userSub'],ids,row=>!finishedOrders.has(String(row.status||'').toLowerCase()));
  const holds=await scanOwned(TABLES.holds,['walletId'],walletIds,row=>row.status==='ACTIVE');
  const transfers=await scanOwned(TABLES.transfers,['sourceWalletId','recipientWalletId'],walletIds,row=>row.transferId&&!finishedTransfers.has(row.status));
  // Snapshot only: the execution adapter must obtain a conditional eligibility lock and
  // enforce it in order/transfer services before these facts authorize irreversible cleanup.
  return {complete:true,profileIds:[...profiles.keys()],wallets,activeOrders:orders.map(o=>({orderId:o.orderId,status:o.status})),activeHolds:holds.map(h=>({orderId:h.orderId,status:h.status})),pendingTransfers:transfers.map(t=>({transferId:t.transferId,status:t.status}))};
 };
}
module.exports={customerEvidence,belongs,TABLES};
