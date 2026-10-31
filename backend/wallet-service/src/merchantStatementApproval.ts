import {toWholeIqdExact,readMoney} from './money';
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import type {SettlementBatchAuthority} from './merchantSettlementBatch';
type Row=Record<string,any>;
const T='staging-MerchantPlatform',fail=(code='SETTLEMENT_APPROVAL_UNAVAILABLE'):never=>{throw Object.assign(Error(code),{code});};
const key=(branchId:string,batchId:string)=>({pk:'MERCHANT_SETTLEMENT#'+branchId,sk:'APPROVAL#'+batchId});
/** Caller must already hold branch READ authority. No payout authority is created. */
export async function readMerchantStatementApproval(db:Pick<DynamoDBDocumentClient,'send'>,branchId:string,batchId:string,batchDigest:string){
 const row=await strongGet(db,T,key(branchId,batchId));if(!row)return null;const {pk,sk,digest,...body}=row;
 if(!equal({pk,sk},key(branchId,batchId))||quoteHash(body)!==digest||row.kind!=='MERCHANT_STATEMENT_APPROVAL'||row.schemaVersion!==1||row.branchId!==branchId||row.batchId!==batchId||row.batchDigest!==batchDigest||row.status!=='APPROVED_NOT_PAID'||row.approvalPolicy!=='SINGLE_ADMIN'||row.payoutAuthorized!==false||row.walletMutationPerformed!==false||!quoteEntityIdValid(row.approvedBy)||!Number.isFinite(Date.parse(row.approvedAt)))return fail('SETTLEMENT_APPROVAL_PROOF_INVALID');
 return row;
}
export function createMerchantStatementApproval(options:{db:Pick<DynamoDBDocumentClient,'send'>;authorize:(branchId:string)=>Promise<SettlementBatchAuthority>;readBatch:(v:unknown)=>Promise<{header:Row;lines:Row[]}>;now?:()=>number}){
 const {db}=options,now=options.now??Date.now;
 return async(value:unknown)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||!['batchDigest,batchId,branchId','batchDigest,batchId,branchId,confirmOffCycle'].includes(Object.keys(value).sort().join(',')))return fail('INVALID_SETTLEMENT_APPROVAL_REQUEST');
  const v=value as Row;if(!quoteEntityIdValid(v.branchId)||!/^MSB:[a-f0-9]{48}$/.test(v.batchId)||! /^[a-f0-9]{64}$/.test(v.batchDigest))return fail('INVALID_SETTLEMENT_APPROVAL_REQUEST');
  const actor=await options.authorize(v.branchId),saved=await options.readBatch({branchId:v.branchId,batchId:v.batchId});
  if(saved.header.period?.kind==='MERCHANT_OFF_CYCLE_PERIOD'){if(v.confirmOffCycle!==true)return fail('SETTLEMENT_OFF_CYCLE_CONFIRMATION_REQUIRED');const employee=await strongGet(db,'staging-PlatformStaff',{pk:'EMPLOYEE#'+actor.actorId,sk:'PROFILE'});if(!employee||!Number.isSafeInteger(employee.approvalLimit)||employee.approvalLimit<toWholeIqdExact(readMoney(saved.header.summary.amounts.merchantNet)))return fail('SETTLEMENT_APPROVAL_LIMIT');if(!equal(actor,await options.authorize(v.branchId)))return fail('SETTLEMENT_AUTHORIZATION_CHANGED');}
  if(saved.header.period?.kind!=='MERCHANT_OFF_CYCLE_PERIOD'&&v.confirmOffCycle!==undefined)return fail('INVALID_SETTLEMENT_APPROVAL_REQUEST');
  if(saved.header.batchDigest!==v.batchDigest)return fail('SETTLEMENT_PREVIEW_CHANGED');
  const prior=await readMerchantStatementApproval(db,v.branchId,v.batchId,v.batchDigest);if(prior)return {approval:prior,replayed:true};
  const branchKey={businessId:v.branchId},branch=await strongGet(db,'WhizzMerchants_Businesses',branchKey);
  if(!branch||branch.ownerId!==branch.cognitoUserId||branch.status!=='approved'||branch.deletionRequestId!=null||branch.deletedAt!=null||branch.isDeleted===true)return fail('SETTLEMENT_BRANCH_UNAVAILABLE');
  const operations:Row[]=[...actor.guards,exactCheck(T,{pk:saved.header.pk,sk:saved.header.sk},saved.header),exactCheck('WhizzMerchants_Businesses',branchKey,branch)];
  for(const pk of ['BUSINESS_LIFECYCLE#MERCHANT#'+v.branchId,'ACCOUNT_LIFECYCLE#MERCHANT#'+branch.ownerId]){
   const k={pk,sk:'META'};if(await strongGet(db,'staging-AccountDeletion',k))return fail('SETTLEMENT_BRANCH_UNAVAILABLE');operations.push({ConditionCheck:{TableName:'staging-AccountDeletion',Key:k,ConditionExpression:'attribute_not_exists(pk)'}});
  }
  for(const line of saved.lines){
   const k={orderId:line.orderId,sk:'MERCHANT_PAYABLE'},payable=await strongGet(db,'staging-Holds',k);
   if(!payable||payable.status!=='LOCKED_PENDING_SETTLEMENT'||payable.settlementBatchId!==v.batchId||payable.settlementLineDigest!==line.lineDigest||payable.branchId!==v.branchId)return fail('SETTLEMENT_SOURCE_CHANGED_OR_ALREADY_CLAIMED');
   operations.push(exactCheck(T,{pk:line.pk,sk:line.sk},line),exactCheck('staging-Holds',k,payable));
  }
  const at=new Date(now()).toISOString(),body={schemaVersion:1,kind:'MERCHANT_STATEMENT_APPROVAL',branchId:v.branchId,batchId:v.batchId,batchDigest:v.batchDigest,status:'APPROVED_NOT_PAID',approvalPolicy:'SINGLE_ADMIN',approvedBy:actor.actorId,approvedAt:at,payoutAuthorized:false,walletMutationPerformed:false,retentionClass:'FINANCIAL_SETTLEMENT'},approval={...key(v.branchId,v.batchId),...body,digest:quoteHash(body)};
  operations.push({Put:{TableName:T,Item:approval,ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:at+'#'+v.batchId+'#APPROVED',action:'MERCHANT_STATEMENT_APPROVED',actorId:actor.actorId,branchId:v.branchId,batchId:v.batchId,batchDigest:v.batchDigest,createdAt:at},ConditionExpression:'attribute_not_exists(sk)'}});
  if(!equal(actor,await options.authorize(v.branchId)))return fail('SETTLEMENT_AUTHORIZATION_CHANGED');
  try{await db.send(new TransactWriteCommand({TransactItems:operations as any,ClientRequestToken:quoteHash(operations).slice(0,36)}));}
  catch(error){const committed=await readMerchantStatementApproval(db,v.branchId,v.batchId,v.batchDigest);if(committed&&equal(actor,await options.authorize(v.branchId)))return {approval:committed,replayed:true};throw error;}
  return {approval,replayed:false};
 };
}
