import {DynamoDBDocumentClient,QueryCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal,updateChecked} from './driverFinancialTransaction';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {fromWholeIqd,toWholeIqdExact,readMoney} from './money';
import {cashVoucherNumber,cashMovementKey,cashboxKey,cashboxCode} from './merchantCashbox';
import {cashPayoutPosting,verifyCashPayoutPosting,cashAccountingDeduplicate} from './cashboxAccounting';
import {ledgerEffect} from './ledgerEffects';
import {DRIVER_PAYOUT_POLICY,payoutFail as fail,readDriverPayoutEligibility,validDriverPayoutWallet} from './driverPayoutEligibility';
type Row=Record<string,any>;
export type DriverPayoutAuthority={actorId:string;driver:boolean;driverName:string;guards:Row[]};
const P='staging-MerchantPlatform',W='staging-Wallets',L='staging-LedgerEntries';
const uuid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const key=(driverId:string,sk:string)=>({pk:'DRIVER_PAYOUT#'+driverId,sk});
const seal=(v:Row)=>({...v,digest:quoteHash(v)});
function put(row:Row,prior?:Row){if(!prior)return {Put:{TableName:P,Item:row,ConditionExpression:'attribute_not_exists(pk)'}};const {Key,...q}=exactCheck(P,{pk:row.pk,sk:row.sk},prior).ConditionCheck;return {Put:{...q,Item:row}};}
function fields(check:Row,value:Row){const names:Row={},values:Row={};const set=Object.entries(value).map(([k,v],i)=>{names['#u'+i]=k;values[':u'+i]=v;return '#u'+i+'=:u'+i;}).join(',');return updateChecked(check,'SET '+set,names,values);}
export async function verifyDriverCashPaid(db:Pick<DynamoDBDocumentClient,'send'>,row:Row){
 if(row.kind!=='DRIVER_CASH_PAYOUT'||row.beneficiaryType!=='DRIVER'||row.status!=='PAID'||row.method!=='CASH'||!row.cashLedgerJournalId)return fail('DRIVER_PAYOUT_PAID_PROOF_INVALID');
 const n=toWholeIqdExact(readMoney(row.amount)),j=await strongGet(db,P,{pk:'DRIVER_PAYOUT_PAID#'+row.payoutId,sk:'META'});
 if(!j)return fail('DRIVER_PAYOUT_PAID_PROOF_INVALID');const {digest,...body}=j;
 const lines=[{account:'DRIVER_WALLET_PAYABLE',side:'DEBIT',amountIqd:n},{account:'DRIVER_DISBURSEMENT_CLEARING',side:'CREDIT',amountIqd:n}];
 if(digest!==quoteHash(body)||j.kind!=='DRIVER_PAYOUT_PAID_JOURNAL'||j.schemaVersion!==1||j.driverId!==row.driverId||j.payoutId!==row.payoutId||j.status!=='PAID'||!equal(j.amount,row.amount)||j.receiptActorId!==row.driverId||j.receiptAt!==row.receiptAt||j.paidAt!==row.paidAt||j.cashLedgerJournalId!==row.cashLedgerJournalId||j.sourceAccount!==row.sourceAccount||j.externalReference!==row.externalReference||j.debit!==n||j.credit!==n||!equal(j.lines,lines)||!uuid(j.requestId))return fail('DRIVER_PAYOUT_PAID_PROOF_INVALID');
 const entry=await strongGet(db,L,{walletId:'WALLET#DRIVER#'+row.driverId,sk:'ts#'+j.paidAt+'#LOCKED#'+j.requestId});
 if(!entry||entry.category!=='DRIVER_PAYOUT_PAID'||entry.relatedEntityId!==row.payoutId)return fail('DRIVER_PAYOUT_PAID_PROOF_INVALID');
 const fx=ledgerEffect(entry);if(fx.status!=='CLASSIFIED'||fx.bucket!=='LOCKED'||fx.delta!==-n)return fail('DRIVER_PAYOUT_PAID_PROOF_INVALID');
 await verifyCashPayoutPosting(db,row);return j;
}
export const driverPayoutView=(r:Row)=>Object.fromEntries(['payoutId','driverId','recipientName','amount','status','version','createdAt','updatedAt','cashVoucherNumber','sourceAccount','cashbox','executionRecordedAt','receiptAt','paidAt','reason','problemReason','policyVersion'].map(k=>[k,r[k]??null]));
/** Same cashbox, custody, voucher, receipt and reconciliation cycle as merchant
 * payout. Beneficiary/source adapters are separate: no fabricated merchant branch.
 * No PSP calls, no auto-payment, and no wallet credit for retained COD earnings.
 */
export function createDriverCashPayout(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;
 authorize:(driverId:string,role:'READ'|'DRIVER'|'STAFF'|'APPROVE',amount:number)=>Promise<DriverPayoutAuthority>;
 eligibility?:(driverId:string)=>Promise<any>;notificationsTable?:string}){
 const {db}=options,now=options.now??Date.now;
 const get=(k:Row)=>strongGet(db,P,k);
 async function write(driverId:string,role:any,amount:number,a:DriverPayoutAuthority,ops:Row[]){
  const latest=await options.authorize(driverId,role,amount);if(!equal(a,latest))return fail('DRIVER_PAYOUT_AUTHORIZATION_CHANGED');
  await db.send(new TransactWriteCommand({TransactItems:cashAccountingDeduplicate([...a.guards,...ops]) as any}));
 }
 function ledger(w:Row,p:Row,deltaA:number,deltaL:number,category:string,requestId:string,at:string){
  const ops:Row[]=[];for(const [bucket,delta,before]of [['AVAILABLE',deltaA,w.availableBalance],['LOCKED',deltaL,w.lockedBalance]]as const){if(!delta)continue;ops.push({Put:{TableName:L,Item:{walletId:w.walletId,sk:'ts#'+at+'#'+bucket+'#'+requestId,transactionId:'DPC:'+requestId,type:delta>0?'CREDIT':'DEBIT',category,amount:delta,balanceBefore:before,balanceAfter:before+delta,relatedEntityId:p.payoutId,relatedEntityType:'DRIVER_PAYOUT',createdAt:at,metadata:{driverId:p.driverId,payoutId:p.payoutId,balanceType:bucket,financialSchemaVersion:1}},ConditionExpression:'attribute_not_exists(walletId)'}});}return ops;
 }
 async function walletMove(p:Row,a:number,l:number,category:string,id:string,at:string){
  const wk={walletId:'WALLET#DRIVER#'+p.driverId,sk:'META'},w=validDriverPayoutWallet(await strongGet(db,W,wk),p.driverId);
  if(w.driverPayoutActiveId!==p.payoutId)return fail('DRIVER_PAYOUT_RESERVATION_CHANGED');
  const n=toWholeIqdExact(readMoney(p.amount)),reserved=(w.driverPayoutReservedIqd??0)+(category==='DRIVER_PAYOUT_RESERVED'?n:-n);
  if(w.availableBalance+a<0||w.lockedBalance+l<0||reserved<0||reserved>w.lockedBalance+l||![w.availableBalance+a,w.lockedBalance+l,reserved].every(Number.isSafeInteger))return fail('DRIVER_PAYOUT_RESERVATION_CHANGED');
  return [fields(exactCheck(W,wk,w,[...Object.keys(w),'driverPayoutReservedIqd','driverPayoutActiveId','deletedAt','deletionRequestId','isDeleted']),{availableBalance:w.availableBalance+a,lockedBalance:w.lockedBalance+l,driverPayoutReservedIqd:reserved,driverPayoutActiveId:null,version:w.version+1,updatedAt:at}),...ledger(w,p,a,l,category,id,at)];
 }
 async function request(v:Row){
  if(Object.keys(v).sort().join(',')!=='action,amountIqd,driverId,requestId'||!uuid(v.requestId)||!Number.isSafeInteger(v.amountIqd)||v.amountIqd<=0||v.amountIqd>1000000000)return fail('DRIVER_PAYOUT_INVALID_REQUEST');
  const a=await options.authorize(v.driverId,'DRIVER',v.amountIqd),id='DPO:'+quoteHash({driverId:v.driverId,requestId:v.requestId}).slice(0,48),k=key(v.driverId,'PAYOUT#'+id),old=await get(k),digest=quoteHash(v);
  if(old){if(old.requestDigest!==digest||old.requestedBy!==a.actorId)return fail('DRIVER_PAYOUT_IDEMPOTENCY_CONFLICT');return {success:true,payout:driverPayoutView(old),replayed:true};}
  const eligibility=await(options.eligibility?options.eligibility(v.driverId):readDriverPayoutEligibility(db,v.driverId));
  if(eligibility.budget.policyVersion!==DRIVER_PAYOUT_POLICY||eligibility.budget.eligibleIqd<v.amountIqd)return fail('DRIVER_PAYOUT_NOT_ELIGIBLE');
  const {sources,...sourceSummary}=eligibility.budget;
  const at=new Date(now()).toISOString(),row={...k,kind:'DRIVER_CASH_PAYOUT',schemaVersion:1,beneficiaryType:'DRIVER',driverId:v.driverId,payoutId:id,recipientName:a.driverName,amount:fromWholeIqd(v.amountIqd),method:'CASH',status:'UNDER_REVIEW',version:1,requestedBy:a.actorId,reservationRequestId:v.requestId,requestDigest:digest,policyVersion:DRIVER_PAYOUT_POLICY,sourceEvidence:{...sourceSummary,sourceCount:sources.length},createdAt:at,updatedAt:at};
  const w=validDriverPayoutWallet(eligibility.wallet,v.driverId);if(w.driverPayoutActiveId!=null)return fail('DRIVER_PAYOUT_ACTIVE_REQUEST');if(w.availableBalance<v.amountIqd)return fail('DRIVER_PAYOUT_NOT_ELIGIBLE');
  const directory={pk:'DRIVER_PAYOUT_DIRECTORY#GLOBAL',sk:'REQUEST#'+at+'#'+id,kind:'DRIVER_PAYOUT_DIRECTORY',driverId:v.driverId,payoutId:id,recipientName:a.driverName,amount:row.amount,status:row.status,version:1,createdAt:at,updatedAt:at};
  const ops=[put(directory),fields(eligibility.walletGuard,{availableBalance:w.availableBalance-v.amountIqd,lockedBalance:w.lockedBalance+v.amountIqd,driverPayoutReservedIqd:(w.driverPayoutReservedIqd??0)+v.amountIqd,driverPayoutActiveId:id,version:w.version+1,updatedAt:at}),...ledger(w,row,-v.amountIqd,v.amountIqd,'DRIVER_PAYOUT_RESERVED',v.requestId,at),put(row),{Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:at+'#'+v.requestId,logId:v.requestId,action:'DRIVER_PAYOUT_REQUEST',driverId:v.driverId,payoutId:id,actorId:a.actorId,amountIqd:v.amountIqd,createdAt:at},ConditionExpression:'attribute_not_exists(sk)'}}];
  try{await write(v.driverId,'DRIVER',v.amountIqd,a,ops);}catch(e){const saved=await get(k);if(saved?.requestDigest===digest&&saved.requestedBy===a.actorId)return {success:true,payout:driverPayoutView(saved),replayed:true};throw e;}
  return {success:true,payout:driverPayoutView(row)};
 }
 const rules:Row={APPROVE:{from:['UNDER_REVIEW'],to:'APPROVED',role:'APPROVE'},BEGIN:{from:['APPROVED'],to:'PROCESSING',role:'STAFF'},DELIVER:{from:['PROCESSING'],to:'AWAITING_RECEIPT',role:'STAFF'},ACK_RECEIPT:{from:['AWAITING_RECEIPT'],to:'RECEIPT_CONFIRMED',role:'DRIVER'},RECONCILE:{from:['RECEIPT_CONFIRMED'],to:'PAID',role:'APPROVE'},CANCEL:{from:['UNDER_REVIEW','APPROVED'],to:'CANCELLED',role:'DRIVER'},REJECT:{from:['UNDER_REVIEW'],to:'CANCELLED',role:'APPROVE'},REPORT_PROBLEM:{from:['PROCESSING','AWAITING_RECEIPT','RECEIPT_CONFIRMED'],to:'RECONCILIATION_REQUIRED',role:'DRIVER'},ACK_NOT_RECEIVED:{from:['RECONCILIATION_REQUIRED'],to:'NON_RECEIPT_CONFIRMED',role:'DRIVER'},RESOLVE_NOT_PAID:{from:['NON_RECEIPT_CONFIRMED'],to:'FAILED_NOT_PAID',role:'APPROVE'}};
 async function act(v:Row){
  const rule=rules[v.action];if(!rule||!uuid(v.requestId)||!/^DPO:[a-f0-9]{48}$/.test(v.payoutId||'')||!Number.isSafeInteger(v.version)||Object.keys(v).some(k=>!['action','driverId','payoutId','version','requestId','reason','cashboxId','receivedAmountIqd','confirmed','cashboxOverrideReason','failureReference'].includes(k)))return fail('DRIVER_PAYOUT_INVALID_REQUEST');
  const k=key(v.driverId,'PAYOUT#'+v.payoutId),row=await get(k);if(!row||row.kind!=='DRIVER_CASH_PAYOUT'||row.driverId!==v.driverId||row.payoutId!==v.payoutId||row.beneficiaryType!=='DRIVER'||row.policyVersion!==DRIVER_PAYOUT_POLICY)return fail('DRIVER_PAYOUT_UNAVAILABLE');
  const n=toWholeIqdExact(readMoney(row.amount)),a=await options.authorize(v.driverId,rule.role,n),ek=key(v.driverId,'EVENT#'+v.payoutId+'#'+v.requestId),prior=await get(ek),digest=quoteHash(v);
  if(prior){if(prior.requestDigest!==digest||prior.actorId!==a.actorId)return fail('DRIVER_PAYOUT_IDEMPOTENCY_CONFLICT');return {success:true,payout:driverPayoutView(row),replayed:true};}
  if(row.version!==v.version||!rule.from.includes(row.status))return fail('DRIVER_PAYOUT_STATE_CHANGED');
  const at=new Date(now()).toISOString(),next:Row={...row,status:rule.to,version:row.version+1,updatedAt:at},ops:Row[]=[];
  if(!uuid(row.reservationRequestId)||row.payoutId!=='DPO:'+quoteHash({driverId:v.driverId,requestId:row.reservationRequestId}).slice(0,48))return fail('DRIVER_PAYOUT_RESERVATION_PROOF_REQUIRED');
  for(const [bucket,delta]of [['AVAILABLE',-n],['LOCKED',n]]as const){
   const lk={walletId:'WALLET#DRIVER#'+v.driverId,sk:'ts#'+row.createdAt+'#'+bucket+'#'+row.reservationRequestId},entry=await strongGet(db,L,lk);
   if(!entry||entry.category!=='DRIVER_PAYOUT_RESERVED'||entry.relatedEntityId!==row.payoutId||entry.transactionId!=='DPC:'+row.reservationRequestId)return fail('DRIVER_PAYOUT_RESERVATION_PROOF_REQUIRED');
   const fx=ledgerEffect(entry);if(fx.status!=='CLASSIFIED'||fx.bucket!==bucket||fx.delta!==delta)return fail('DRIVER_PAYOUT_RESERVATION_PROOF_REQUIRED');
   ops.push(exactCheck(L,lk,entry));
  }
  if(!['CANCEL','REJECT','RESOLVE_NOT_PAID','RECONCILE'].includes(v.action)){
   const wk={walletId:'WALLET#DRIVER#'+v.driverId,sk:'META'},w=validDriverPayoutWallet(await strongGet(db,W,wk),v.driverId);
   if(w.driverPayoutActiveId!==row.payoutId||(w.driverPayoutReservedIqd??0)<n||w.lockedBalance<n)return fail('DRIVER_PAYOUT_RESERVATION_CHANGED');ops.push(exactCheck(W,wk,w,[...Object.keys(w),'driverPayoutReservedIqd','driverPayoutActiveId','deletedAt','deletionRequestId','isDeleted']));
  }

  const dk={pk:'DRIVER_PAYOUT_DIRECTORY#GLOBAL',sk:'REQUEST#'+row.createdAt+'#'+row.payoutId},directory=await get(dk);
  if(!directory||directory.kind!=='DRIVER_PAYOUT_DIRECTORY'||directory.driverId!==v.driverId||directory.payoutId!==row.payoutId||directory.status!==row.status||directory.version!==row.version||!equal(directory.amount,row.amount))return fail('DRIVER_PAYOUT_DIRECTORY_CHANGED');
  ops.push(put({...directory,status:next.status,version:next.version,updatedAt:at},directory));
  const reason=()=>{if(typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>500)return fail('DRIVER_PAYOUT_REASON_REQUIRED');return v.reason.trim();};
  if(v.action==='APPROVE'){next.approvedBy=a.actorId;next.approvedAt=at;}
  if(v.action==='BEGIN'){next.executedBy=a.actorId;next.executionStartedAt=at;next.cashVoucherNumber=cashVoucherNumber(row);}
  if(v.action==='DELIVER'){
   if(v.confirmed!==true||v.receivedAmountIqd!==n||!cashboxCode(v.cashboxId))return fail('DRIVER_PAYOUT_EXECUTION_PROOF_REQUIRED');
   const box=await get(cashboxKey(v.cashboxId));if(!box||box.kind!=='MERCHANT_CASHBOX'||box.status!=='ACTIVE')return fail('PAYOUT_CASHBOX_UNAVAILABLE');
   Object.assign(next,{sourceAccount:box.code,cashVoucherNumber:row.cashVoucherNumber||cashVoucherNumber(row),externalReference:row.cashVoucherNumber||cashVoucherNumber(row),cashbox:{code:box.code,name:box.name,custodian:box.custodian,location:box.location,custodianEmployeeId:box.custodianEmployeeId},executionRecordedBy:a.actorId,executionRecordedAt:at});
   const posting=await cashPayoutPosting(db,next,a.actorId,at,false,v.cashboxOverrideReason);next.cashLedgerJournalId=posting.journalId;ops.push(...posting.ops,put({...cashMovementKey(next),kind:'DRIVER_CASH_DISBURSEMENT',schemaVersion:1,version:1,beneficiaryType:'DRIVER',driverId:v.driverId,payoutId:row.payoutId,voucherNumber:next.externalReference,recipientName:row.recipientName,amount:row.amount,cashbox:next.cashbox,status:next.status,executedAt:at,executedBy:a.actorId,updatedAt:at,retentionClass:'FINANCIAL_SETTLEMENT'}));
  }
  if(v.action==='ACK_RECEIPT'){if(v.confirmed!==true||v.receivedAmountIqd!==n||!row.cashLedgerJournalId)return fail('DRIVER_PAYOUT_RECEIPT_REQUIRED');Object.assign(next,{receiptAt:at,receiptActorId:a.actorId});}
  if(v.action==='REPORT_PROBLEM')next.problemReason=reason();
  if(v.action==='ACK_NOT_RECEIVED'){if(v.confirmed!==true)return fail('DRIVER_PAYOUT_NON_RECEIPT_REQUIRED');next.nonReceiptActorId=a.actorId;next.nonReceiptAt=at;}
  if(['CANCEL','REJECT','RESOLVE_NOT_PAID'].includes(v.action)){
   next.reason=reason();if(v.action==='RESOLVE_NOT_PAID'){
    if(v.confirmed!==true||row.nonReceiptActorId!==v.driverId||!row.nonReceiptAt||typeof v.failureReference!=='string'||v.failureReference.trim().length<5||v.failureReference.length>150)return fail('DRIVER_PAYOUT_RETURN_PROOF_REQUIRED');
    next.failureReference=v.failureReference.trim().toUpperCase();next.failureReason=next.reason;
    if(row.cashLedgerJournalId){ops.push(put({pk:'DRIVER_PAYOUT_RETURN_REFERENCE#'+quoteHash({sourceAccount:row.sourceAccount,reference:next.failureReference}),sk:'META',payoutId:row.payoutId,driverId:v.driverId,createdAt:at}));const posting=await cashPayoutPosting(db,{...row,...next},a.actorId,at,true);next.cashReturnJournalId=posting.journalId;ops.push(...posting.ops);}
   }
   ops.push(...await walletMove(row,n,-n,'DRIVER_PAYOUT_RELEASED',v.requestId,at));
  }
  if(v.action==='RECONCILE'){
   if(row.receiptActorId!==v.driverId||!row.receiptAt||!row.cashLedgerJournalId)return fail('DRIVER_PAYOUT_RECEIPT_REQUIRED');
   const proof=await verifyCashPayoutPosting(db,row);if(!proof)return fail('DRIVER_PAYOUT_EXECUTION_PROOF_REQUIRED');ops.push(exactCheck(P,{pk:proof.pk,sk:proof.sk},proof),...await walletMove(row,0,-n,'DRIVER_PAYOUT_PAID',v.requestId,at));
   next.paidAt=at;next.reconciledBy=a.actorId;
   ops.push(put(seal({pk:'DRIVER_PAYOUT_PAID#'+row.payoutId,sk:'META',kind:'DRIVER_PAYOUT_PAID_JOURNAL',requestId:v.requestId,schemaVersion:1,status:'PAID',driverId:v.driverId,payoutId:row.payoutId,amount:row.amount,cashLedgerJournalId:row.cashLedgerJournalId,sourceAccount:row.sourceAccount,externalReference:row.externalReference,receiptAt:row.receiptAt,receiptActorId:row.receiptActorId,paidAt:at,reconciledBy:a.actorId,debit:n,credit:n,lines:[{account:'DRIVER_WALLET_PAYABLE',side:'DEBIT',amountIqd:n},{account:'DRIVER_DISBURSEMENT_CLEARING',side:'CREDIT',amountIqd:n}],retentionClass:'FINANCIAL_SETTLEMENT'})));
  }
  if(row.cashLedgerJournalId&&['ACK_RECEIPT','REPORT_PROBLEM','ACK_NOT_RECEIVED','RESOLVE_NOT_PAID','RECONCILE'].includes(v.action)){
   const movement=await get(cashMovementKey(row));if(!movement||movement.kind!=='DRIVER_CASH_DISBURSEMENT'||movement.driverId!==v.driverId||movement.payoutId!==row.payoutId||!equal(movement.amount,row.amount)||!equal(movement.cashbox,row.cashbox))return fail('DRIVER_PAYOUT_CASH_REGISTER_INVALID');ops.push(put({...movement,status:next.status,version:movement.version+1,updatedAt:at,updatedBy:a.actorId},movement));
  }
  if(options.notificationsTable){
   const title=next.status==='AWAITING_RECEIPT'?'تأكيد استلام صرف المحفظة':next.status==='PAID'?'اكتمل صرف المحفظة':'تحديث طلب صرف المحفظة';
   const body=next.status==='AWAITING_RECEIPT'?'سُجّل تسليم النقد من الصندوق. افتح صرف رصيد المحفظة وأكد ما استلمته فعليًا.':next.status==='PAID'?'اكتملت مطابقة سند الصرف وتأكيد استلامك.':'افتح المحفظة لمتابعة حالة طلب الصرف.';
   ops.push({Put:{TableName:options.notificationsTable,Item:{eventId:'DRIVER_PAYOUT#'+row.payoutId+'#'+next.version,driverId:v.driverId,payoutId:row.payoutId,type:'wallet_cash_payout',title,body,createdAt:at,deliveryStatus:'PENDING',nextAttemptAt:0,attempts:0},ConditionExpression:'attribute_not_exists(eventId)'}});
  }
  ops.push(put(next,row),put({...ek,kind:'DRIVER_PAYOUT_EVENT',actorId:a.actorId,action:v.action,from:row.status,to:next.status,at,requestDigest:digest}),{Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:at+'#'+v.requestId,logId:v.requestId,action:'DRIVER_PAYOUT_'+v.action,driverId:v.driverId,payoutId:row.payoutId,actorId:a.actorId,amountIqd:n,createdAt:at},ConditionExpression:'attribute_not_exists(sk)'}});
  try{await write(v.driverId,rule.role,n,a,ops);}catch(e){const saved=await get(ek);if(saved?.actorId===a.actorId&&saved.requestDigest===digest)return {success:true,payout:driverPayoutView((await get(k))!),replayed:true};throw e;}
  return {success:true,payout:driverPayoutView(next)};
 }
 return {async handle(v:Row):Promise<Row>{
  if(!v||!quoteEntityIdValid(v.driverId))return fail('DRIVER_PAYOUT_INVALID_DRIVER');
  if(v.action==='READ_PAYOUT'){
   if(Object.keys(v).sort().join(',')!=='action,driverId,payoutId'||!/^DPO:[a-f0-9]{48}$/.test(v.payoutId||''))return fail('DRIVER_PAYOUT_INVALID_REQUEST');
   const a=await options.authorize(v.driverId,'READ',0),row=await get(key(v.driverId,'PAYOUT#'+v.payoutId));
   if(!row||row.driverId!==v.driverId||row.kind!=='DRIVER_CASH_PAYOUT')return fail('DRIVER_PAYOUT_UNAVAILABLE');
   if(row.cashLedgerJournalId)await verifyCashPayoutPosting(db,row);
   if(row.status==='PAID')await verifyDriverCashPaid(db,row);
   if(!equal(a,await options.authorize(v.driverId,'READ',0)))return fail('DRIVER_PAYOUT_AUTHORIZATION_CHANGED');
   return {success:true,payout:driverPayoutView(row)};
  }
  if(v.action==='REQUEST')return request(v);
  if(v.action==='READ'){
   if(Object.keys(v).some(k=>!['action','driverId','cursor'].includes(k)))return fail('DRIVER_PAYOUT_INVALID_REQUEST');
   let cursor:Row|undefined;if(v.cursor){try{cursor=JSON.parse(Buffer.from(v.cursor,'base64url').toString());if(!cursor||Object.keys(cursor).sort().join(',')!=='pk,sk'||cursor.pk!==key(v.driverId,'').pk||typeof cursor.sk!=='string'||!/^PAYOUT#DPO:[a-f0-9]{48}$/.test(cursor.sk))throw Error();}catch{return fail('DRIVER_PAYOUT_INVALID_CURSOR');}}
   const a=await options.authorize(v.driverId,'READ',0);let eligibility:Row,active:Row|null=null;
   try{const r=await(options.eligibility?options.eligibility(v.driverId):readDriverPayoutEligibility(db,v.driverId));eligibility={status:'VERIFIED',...r.budget,sources:undefined,activePayoutId:r.wallet.driverPayoutActiveId??null};if(r.wallet.driverPayoutActiveId)active=await get(key(v.driverId,'PAYOUT#'+r.wallet.driverPayoutActiveId));}catch(e:any){eligibility={status:'REVIEW_REQUIRED',code:e.code||'DRIVER_PAYOUT_RECONCILIATION_REQUIRED',eligibleIqd:null};}
   const out=await db.send(new QueryCommand({TableName:P,KeyConditionExpression:'pk=:p AND begins_with(sk,:s)',ExpressionAttributeValues:{':p':key(v.driverId,'').pk,':s':'PAYOUT#'},ConsistentRead:true,Limit:25,...(cursor?{ExclusiveStartKey:cursor}:{})}));
   for(const r of (out.Items||[]))if(r.status==='PAID')await verifyDriverCashPaid(db,r);
   if(!equal(a,await options.authorize(v.driverId,'READ',0)))return fail('DRIVER_PAYOUT_AUTHORIZATION_CHANGED');
   return {success:true,eligibility,items:[...(active&&!(out.Items||[]).some(r=>r.payoutId===active!.payoutId)?[active]:[]),...(out.Items||[])].map(driverPayoutView),nextCursor:out.LastEvaluatedKey?Buffer.from(JSON.stringify(out.LastEvaluatedKey)).toString('base64url'):null};
  }
  return act(v);
 }};
}
