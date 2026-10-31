'use strict';
// Read-only, branch-scoped discovery followed by strong accounting evidence reads.
const {QueryCommand,GetCommand}=require('@aws-sdk/lib-dynamodb');
const {readMerchantAccrualEvidence}=require('./settlement-runtime');
const invalid=()=>{throw Object.assign(Error('INVALID_SCHEDULE_REQUEST'),{status:400});};
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v);
const fields=require('./settlement-evidence-fields.json');
function projectEvidenceDb(db){return {send(command){const q=command.input,keys=fields[q.TableName];if(command.constructor.name!=='GetCommand'||!keys||q.TableName==='staging-MerchantPlatform'&&!String(q.Key?.pk||'').startsWith('FULL_CASH_JOURNAL#'))return db.send(command);const names=Object.fromEntries(keys.map((field,n)=>['#p'+n,field]));return db.send(new GetCommand({...q,ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:names}));}};}
async function read(db,input){
 const evidenceDb=projectEvidenceDb(db);
 if(!input||!valid(input.branchId)||input.view!=='orders'||Object.keys(input).some(k=>!['branchId','view','cursor'].includes(k)))invalid();
 let cursor;
 if(input.cursor){try{if(typeof input.cursor!=='string'||input.cursor.length>2000)invalid();cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString());if(Object.keys(cursor).sort().join(',')!=='sk,walletId'||cursor.walletId!=='WALLET#MERCHANT#'+input.branchId||typeof cursor.sk!=='string'||!cursor.sk.startsWith('ts#'))invalid();}catch{invalid();}}
 const ledgerNames=Object.fromEntries(fields['staging-LedgerEntries'].map((field,n)=>['#l'+n,field]));
 const result=await db.send(new QueryCommand({TableName:'staging-LedgerEntries',Select:'SPECIFIC_ATTRIBUTES',ProjectionExpression:Object.keys(ledgerNames).join(','),ExpressionAttributeNames:ledgerNames,ConsistentRead:true,KeyConditionExpression:'walletId=:wallet',ExpressionAttributeValues:{':wallet':'WALLET#MERCHANT#'+input.branchId},ScanIndexForward:false,Limit:20,...(cursor?{ExclusiveStartKey:cursor}:{})}));
 const items=[];
 for(const row of result.Items||[]){
  if(!['COD_COMPLETED','FULL_CASH_COMPLETED','CASH_ADJUDICATION_SETTLED','ORDER_EXCEPTION_FINANCIAL'].includes(row.category)||row.metadata?.balanceType!=='LOCKED')continue;
  const orderId=row.relatedEntityId;
  if(!valid(orderId)||row.metadata?.orderId!==orderId)throw Error('SETTLEMENT_ORDER_ID_INVALID');
  try{const proof=await readMerchantAccrualEvidence(evidenceDb,input.branchId,orderId);
   if(row.transactionId!==proof.accrual.operationId||row.amount*1000!==proof.accrual.amounts.merchantNet.minorAmount)throw Error('SETTLEMENT_LEDGER_PROOF_MISMATCH');
   items.push({orderId:proof.order.orderId,orderNumber:proof.order.orderNumber||proof.order.orderId,deliveredAt:proof.accrual.deliveredAt,status:proof.payable.status==='PAID'?'PAID':proof.accrual.status,payoutId:proof.payable.paidPayoutId||null,paidAt:proof.payable.paidAt||null,amounts:{...proof.accrual.amounts,...Object.fromEntries(['driverTotalEntitlement','driverCashRetained','driverWalletCreditTotal','driverWalletHold'].filter(k=>proof.outcome.allocation?.[k]!==undefined).map(k=>[k,proof.outcome.allocation?.[k]]))},sourceKind:proof.accrual.kind,operationId:proof.accrual.operationId,agreement:proof.accrual.agreement,evidenceVerified:true,statementId:proof.payable.settlementBatchId||null,payoutAuthorized:false});
  }catch(e){if(e.name==='AccessDeniedException'||e.name==='ThrottlingException')throw e;
   items.push({orderId,orderNumber:orderId,status:'REVIEW_REQUIRED',evidenceVerified:false,payoutAuthorized:false});}
 }
 return {items,nextCursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url'):null,coverage:'CURRENT_PAGE_ONLY',discoveryConsistency:'STRONG_MERCHANT_LEDGER',coverageNote:'Orders with merchant completion postings; zero-payable orders have no merchant ledger entry',amountsVerifiedBy:'STRONG_SOURCE_READS',walletMutationPerformed:false};
}
module.exports={read,projectEvidenceDb};
