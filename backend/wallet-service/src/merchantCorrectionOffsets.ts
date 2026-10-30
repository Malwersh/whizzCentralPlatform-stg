import {DynamoDBDocumentClient,QueryCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {quoteHash} from './deliveryQuoteRecord';
type Row=Record<string,any>;
const P='staging-MerchantPlatform';
export const correctionPolicyKey={pk:'OPERATIONAL_SETTINGS#MERCHANT_CORRECTIONS',sk:'CURRENT'};
const fail=(code='CORRECTION_RESERVATION_CHANGED'):never=>{throw Object.assign(Error(code),{code});};
const key=(b:string,s:string)=>({pk:'MERCHANT_CORRECTIONS#'+b,sk:s});
const integer=(n:any)=>Number.isSafeInteger(n)&&n>=0;
const seal=(r:Row):Row=>({...r,digest:quoteHash(r)});
const sealed=(r:Row|null|undefined)=>{const {digest,...body}=r||{};return typeof digest==='string'&&quoteHash(body)===digest;};
function put(row:Row,old?:Row|null){return {Put:{TableName:P,Item:row,...(old?{ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':old.version}}:{ConditionExpression:'attribute_not_exists(pk)'})}};}
export function correctionPosition(r:Row|null|undefined,branchId:string,ownerId:string):Row{
 const p=r??{...key(branchId,'POSITION'),kind:'MERCHANT_CORRECTION_POSITION',branchId,ownerId,creditIqd:0,debtIqd:0,creditPaidIqd:0,debtRecoveredIqd:0,version:0};
 if(p.branchId!==branchId||p.ownerId!==ownerId||p.kind!=='MERCHANT_CORRECTION_POSITION'||!integer(p.version)||['creditIqd','debtIqd','creditPaidIqd','debtRecoveredIqd'].some(k=>!integer(p[k]))||['creditReservedIqd','debtReservedIqd'].some(k=>p[k]!==undefined&&!integer(p[k])))return fail('CORRECTION_POSITION_INVALID');
 const out:Row={...p,creditReservedIqd:p.creditReservedIqd??0,debtReservedIqd:p.debtReservedIqd??0};
 if(out.creditPaidIqd+out.creditReservedIqd>out.creditIqd||out.debtRecoveredIqd+out.debtReservedIqd>out.debtIqd)return fail('CORRECTION_POSITION_INVALID');return out;
}
export function correctionAmounts(payout:Row){
 const s=payout.correctionSettlement;if(!s)return {baseIqd:payout.amount.minorAmount/1000,creditIqd:0,debtIqd:0,netIqd:payout.amount.minorAmount/1000};
 if(!sealed(s)||s.reservationId!==payout.payoutId||s.branchId!==payout.branchId||s.ownerId!==payout.ownerId||!['baseIqd','creditIqd','debtIqd','netIqd','policyVersion'].every(k=>integer(s[k]))||s.baseIqd<0||s.baseIqd===0&&payout.sourceKind!=='CORRECTIONS_ONLY'||s.baseIqd!==payout.baseAmount?.minorAmount/1000||s.creditIqd+s.debtIqd<=0||!Number.isSafeInteger(s.baseIqd+s.creditIqd)||s.baseIqd+s.creditIqd-s.debtIqd!==s.netIqd||s.netIqd!==payout.amount.minorAmount/1000)return fail('CORRECTION_RESERVATION_PROOF_INVALID');
 if(!Array.isArray(s.allocations)||s.allocations.length<1||s.allocations.length>16||new Set(s.allocations.map((a:Row)=>a.correctionId)).size!==s.allocations.length||s.allocations.some((a:Row)=>!['CREDIT','DEBIT'].includes(a.direction)||!integer(a.amountIqd)||a.amountIqd<=0)||s.allocations.filter((a:Row)=>a.direction==='CREDIT').reduce((n:number,a:Row)=>n+a.amountIqd,0)!==s.creditIqd||s.allocations.filter((a:Row)=>a.direction==='DEBIT').reduce((n:number,a:Row)=>n+a.amountIqd,0)!==s.debtIqd)return fail('CORRECTION_RESERVATION_PROOF_INVALID');
 return {baseIqd:s.baseIqd,creditIqd:s.creditIqd,debtIqd:s.debtIqd,netIqd:s.netIqd};
}
export async function reserveMerchantCorrections(db:Pick<DynamoDBDocumentClient,'send'>,v:{branchId:string;ownerId:string;payoutId:string;baseIqd:number;at:string}){
 const k=key(v.branchId,'POSITION'),raw=await strongGet(db,P,k),p=correctionPosition(raw,v.branchId,v.ownerId),policy=await strongGet(db,P,correctionPolicyKey);
 const ops:Row[]=[policy?exactCheck(P,correctionPolicyKey,policy):{ConditionCheck:{TableName:P,Key:correctionPolicyKey,ConditionExpression:'attribute_not_exists(pk)'}}];
 if(p.creditReservedIqd||p.debtReservedIqd)return fail('CORRECTION_ACTIVE_SETTLEMENT');
 const availableCredit=p.creditIqd-p.creditPaidIqd-p.creditReservedIqd,availableDebt=p.debtIqd-p.debtRecoveredIqd-p.debtReservedIqd;
 if((availableCredit||availableDebt)&&(!policy||policy.kind!=='MERCHANT_CORRECTION_POLICY'||!['OFFSET_NEXT_SETTLEMENT','MANUAL_COLLECTION'].includes(policy.recoveryMode)||policy.applyCredits!==true||!integer(policy.version)||policy.version<1))return fail('CORRECTION_POLICY_REQUIRED');
 let creditIqd=0,debtIqd=0;const allocations:Row[]=[],sources:Row[]=[];let cursor:Row|undefined,done=false;
 if(availableCredit||policy?.recoveryMode==='OFFSET_NEXT_SETTLEMENT'&&availableDebt){
  for(let page=0;page<20;page++){
   const q=await db.send(new QueryCommand({TableName:P,ConsistentRead:true,KeyConditionExpression:'pk=:pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':key(v.branchId,'').pk,':prefix':'REQUEST#'},ScanIndexForward:false,Limit:50,...(cursor?{ExclusiveStartKey:cursor}:{})}));
   sources.push(...(q.Items??[]).filter((r:Row)=>r.status==='POSTED'&&r.amountIqd>(r.settledIqd??0)));cursor=q.LastEvaluatedKey;
   if(!cursor){done=true;break;}
  }
  if(!done)return fail('CORRECTION_SOURCE_LIMIT');
  sources.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.correctionId.localeCompare(b.correctionId));
  const take=(direction:string,limit:number)=>{
   for(const r of sources.filter(r=>r.direction===direction)){
    if(limit<=0)break;
    if(allocations.length>=16)return fail('CORRECTION_SOURCE_LIMIT');
    if(r.branchId!==v.branchId||r.ownerId!==v.ownerId||!integer(r.amountIqd)||!integer(r.settledIqd??0)||!integer(r.reservedIqd??0)||(r.reservedIqd??0)!==0||(r.settledIqd??0)>r.amountIqd||r.kind!=='MERCHANT_SETTLEMENT_CORRECTION')return fail('CORRECTION_SOURCE_INVALID');
    const n=Math.min(limit,r.amountIqd-(r.settledIqd??0));if(!n)continue;
    allocations.push({correctionId:r.correctionId,direction,amountIqd:n,requestDigest:r.requestDigest});limit-=n;
   }
   return limit;
  };
  if(take('CREDIT',availableCredit)!==0)return fail('CORRECTION_SOURCE_INVALID');creditIqd=availableCredit;
  const requiredDebt=policy?.recoveryMode==='OFFSET_NEXT_SETTLEMENT'?Math.min(v.baseIqd+creditIqd,availableDebt):0;
  if(take('DEBIT',requiredDebt)!==0)return fail('CORRECTION_SOURCE_INVALID');debtIqd=requiredDebt;
  for(const allocation of allocations){const r=sources.find(r=>r.correctionId===allocation.correctionId)!,j=await strongGet(db,P,key(v.branchId,'JOURNAL#'+r.correctionId));
   if(!j||!sealed(j)||j.branchId!==v.branchId||j.ownerId!==v.ownerId||j.correctionId!==r.correctionId||j.orderId!==r.orderId||j.requestDigest!==r.requestDigest||j.amountIqd!==r.amountIqd||j.direction!==r.direction)return fail('CORRECTION_SOURCE_INVALID');
   ops.push(exactCheck(P,{pk:j.pk,sk:j.sk},j),put({...r,reservedIqd:allocation.amountIqd,version:r.version+1},r));
  }
 }
 const netIqd=v.baseIqd+creditIqd-debtIqd;
 if(!integer(netIqd))return fail('CORRECTION_POSITION_LIMIT');
 if(!creditIqd&&!debtIqd){ops.push(raw?exactCheck(P,k,raw):{ConditionCheck:{TableName:P,Key:k,ConditionExpression:'attribute_not_exists(pk)'}});return {operations:ops,amountIqd:v.baseIqd,snapshot:undefined};}
 const snapshot=seal({schemaVersion:1,reservationId:v.payoutId,branchId:v.branchId,ownerId:v.ownerId,baseIqd:v.baseIqd,creditIqd,debtIqd,netIqd,allocations,policyVersion:policy!.version});
 const reservation=seal({...key(v.branchId,'RESERVATION#'+v.payoutId),kind:'MERCHANT_CORRECTION_RESERVATION',...v,snapshot,status:'ACTIVE',version:1});
 ops.push(put({...p,creditReservedIqd:p.creditReservedIqd+creditIqd,debtReservedIqd:p.debtReservedIqd+debtIqd,version:p.version+1,updatedAt:v.at},raw),put(reservation));
 return {operations:ops,amountIqd:netIqd,snapshot};
}
export async function finishMerchantCorrections(db:Pick<DynamoDBDocumentClient,'send'>,row:Row,paid:boolean,at:string){
 if(!row.correctionSettlement)return [];
 const a=correctionAmounts(row),k=key(row.branchId,'RESERVATION#'+row.payoutId),r=await strongGet(db,P,k),pk=key(row.branchId,'POSITION'),raw=await strongGet(db,P,pk),p=correctionPosition(raw,row.branchId,row.ownerId);
 if(!r||!sealed(r)||r.status!=='ACTIVE'||!equal(r.snapshot,row.correctionSettlement)||p.creditReservedIqd<a.creditIqd||p.debtReservedIqd<a.debtIqd)return fail();
 const next={...p,creditReservedIqd:p.creditReservedIqd-a.creditIqd,debtReservedIqd:p.debtReservedIqd-a.debtIqd,creditPaidIqd:p.creditPaidIqd+(paid?a.creditIqd:0),debtRecoveredIqd:p.debtRecoveredIqd+(paid?a.debtIqd:0),version:p.version+1,updatedAt:at};
 const sourceOps:Row[]=[];
 for(const allocation of row.correctionSettlement.allocations??[]){const sk=key(row.branchId,'REQUEST#'+allocation.correctionId),source=await strongGet(db,P,sk);
  if(!source||source.ownerId!==row.ownerId||source.branchId!==row.branchId||source.status!=='POSTED'||source.requestDigest!==allocation.requestDigest||source.reservedIqd!==allocation.amountIqd||source.direction!==allocation.direction||(source.settledIqd??0)+allocation.amountIqd>source.amountIqd)return fail('CORRECTION_SOURCE_INVALID');
  sourceOps.push(put({...source,reservedIqd:0,settledIqd:(source.settledIqd??0)+(paid?allocation.amountIqd:0),...(paid?{lastSettlementPayoutId:row.payoutId,lastSettledAt:at}:{}),version:source.version+1},source));
 }
 const {digest,...prior}=r!;return [...sourceOps,put(next,raw),put(seal({...prior,status:paid?'SETTLED':'RELEASED',version:r!.version+1,completedAt:at}),r)];
}
export async function verifyMerchantCorrectionSettlement(db:Pick<DynamoDBDocumentClient,'send'>,row:Row){
 if(!row.correctionSettlement)return;
 correctionAmounts(row);const r=await strongGet(db,P,key(row.branchId,'RESERVATION#'+row.payoutId));
 if(!r||!sealed(r)||r.status!=='SETTLED'||!equal(r.snapshot,row.correctionSettlement)||r.completedAt!==row.paidAt)return fail('CORRECTION_SETTLED_PROOF_INVALID');
}
export function merchantCorrectionPayoutLines(row:Row,fee:number){
 const a=correctionAmounts(row),lines:Row[]=a.baseIqd?[{account:'MERCHANT_PAYABLE',side:'DEBIT',amount:a.baseIqd}]:[];
 if(a.creditIqd)lines.push({account:'MERCHANT_CORRECTION_PAYABLE',side:'DEBIT',amount:a.creditIqd});
 if(fee)lines.push({account:'PAYOUT_FEE_EXPENSE',side:'DEBIT',amount:fee});
 if(a.debtIqd)lines.push({account:'MERCHANT_CORRECTION_RECEIVABLE',side:'CREDIT',amount:a.debtIqd});
 if(a.netIqd+fee)lines.push({account:row.method==='CASH'?(row.cashLedgerJournalId?'MERCHANT_DISBURSEMENT_CLEARING':'CASH_DISBURSEMENT'):'ZAIN_CASH_DISBURSEMENT',side:'CREDIT',amount:a.netIqd+fee});return lines;
}
