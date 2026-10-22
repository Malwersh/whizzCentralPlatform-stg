import {createCashboxAccountingService,cashboxCustodian,cashEmployeeName,cashEmployeeGuard,cashAccountingDeduplicate,cashPayoutPosting,verifyCashPayoutPosting,cashBalanceKey} from './cashboxAccounting';
import {cashboxDirectory,cashboxKey,cashboxCode,cashVoucherNumber,cashMovementKey,validateCashbox} from './merchantCashbox';
import {DynamoDBDocumentClient,GetCommand,QueryCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {randomInt,createHmac,timingSafeEqual} from 'node:crypto';
import {strongGet,exactCheck,equal,updateChecked} from './driverFinancialTransaction';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {readMoney,toWholeIqdExact} from './money';
import {readMerchantDeletionFence} from './merchantSettlementAuthority';
import {readMerchantStatementApproval} from './merchantStatementApproval';
type Row=Record<string,any>;
const P='staging-MerchantPlatform',B='WhizzMerchants_Businesses',H='staging-Holds',W='staging-Wallets',L='staging-LedgerEntries';
function fail(code='PAYOUT_CONFLICT'):never{throw Object.assign(Error(code),{code});}
const id=(v:any)=>quoteEntityIdValid(v),uuid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const pk=(branchId:string)=>'MERCHANT_PAYOUT#'+branchId;
const key=(branchId:string,sk:string)=>({pk:pk(branchId),sk});
const destinationKey=(branchId:string,ownerId:string)=>({pk:'MERCHANT_PAYOUT_DESTINATION#'+branchId,sk:'OWNER#'+ownerId});
const phone=(v:any)=>{let n=typeof v==='string'?v.replace(/[\s()-]/g,''):'';if(/^07\d{9}$/.test(n))n='+964'+n.slice(1);if(/^9647\d{9}$/.test(n))n='+'+n;if(!/^\+9647\d{9}$/.test(n))return fail('PAYOUT_INVALID_PHONE');return n;};
const masked=(v:string)=>'••••'+v.slice(-4);
function put(table:string,row:Row,prior?:Row){
 if(!prior)return {Put:{TableName:table,Item:row,ConditionExpression:'attribute_not_exists(#key)',ExpressionAttributeNames:{'#key':table===H?'orderId':table===L||table==='staging-AuditLog'?'sk':table===W?'walletId':'pk'}}};
 const {Key:_key,...q}=exactCheck(table,table===H?{orderId:row.orderId,sk:row.sk}:table===W?{walletId:row.walletId,sk:row.sk}:{pk:row.pk,sk:row.sk},prior).ConditionCheck;
 return {Put:{...q,Item:row}};
}
function setFields(check:Row,fields:Row){const names:Row={},values:Row={};const assignments=Object.entries(fields).map(([k,v],i)=>{names['#u'+i]=k;values[':u'+i]=v;return '#u'+i+'=:u'+i;});return updateChecked(check,'SET '+assignments.join(','),names,values);}
function seal(body:Row){return {...body,digest:quoteHash(body)};}
function validSeal(row:Row){const {digest,...body}=row||{};return typeof digest==='string'&&digest===quoteHash(body);}
export function verifyMerchantPayoutJournal(row:Row,branchId:string,payable:Row){
 if(!validSeal(row)||row.kind!=='MERCHANT_PAYOUT_PAID_JOURNAL'||row.schemaVersion!==1||row.status!=='PAID'||row.branchId!==branchId||row.payoutId!==payable.paidPayoutId||row.paidAt!==payable.paidAt||row.batchId!==payable.settlementBatchId||row.pk!=='MERCHANT_PAYOUT_PAID#'+row.payoutId||row.sk!=='META'||!['CASH','ZAIN_CASH'].includes(row.method))return fail('PAYOUT_PAID_PROOF_INVALID');
 const amount=toWholeIqdExact(readMoney(row.amount));
 if(!Number.isSafeInteger(amount)||amount<=0||!Number.isSafeInteger(row.executionFee)||row.executionFee<0||!Number.isSafeInteger(amount+row.executionFee)||row.method==='CASH'&&row.executionFee!==0||row.debit!==amount+row.executionFee||row.credit!==amount+row.executionFee||!Array.isArray(row.orderLines)||new Set(row.orderLines.map((l:Row)=>l.orderId)).size!==row.orderLines.length||row.orderLines.reduce((s:number,l:Row)=>s+l.amount,0)!==amount||!row.orderLines.some((l:Row)=>l.orderId===payable.orderId&&l.amount===payable.amount&&l.lineDigest===payable.settlementLineDigest)||row.receiptOwnerId!==row.ownerId||!row.externalReference||!row.sourceAccount||!row.reconciledBy||!equal(row.lines,[{account:'MERCHANT_PAYABLE',side:'DEBIT',amount},...(row.executionFee?[{account:'PAYOUT_FEE_EXPENSE',side:'DEBIT',amount:row.executionFee}]:[]),{account:row.method==='CASH'?(row.cashLedgerJournalId?'MERCHANT_DISBURSEMENT_CLEARING':'CASH_DISBURSEMENT'):'ZAIN_CASH_DISBURSEMENT',side:'CREDIT',amount:amount+row.executionFee}]))return fail('PAYOUT_PAID_PROOF_INVALID');
 return row;
}
/** A paid list badge requires the same sealed, per-order proof as statement details.
 * Caller supplies a strongly validated immutable batch and performs live authorization.
 * This reader never repairs records or changes financial balances.
 */
export async function readMerchantStatementPayment(db:Pick<DynamoDBDocumentClient,'send'>,saved:{header:Row;lines:Row[]},ownerId:string){
 const h=saved.header,claim=await strongGet(db,P,key(h.branchId,'BATCH#'+h.batchId));
 if(claim?.status!=='PAID')return claim;
 if(claim.kind!=='MERCHANT_PAYOUT_CLAIM'||claim.branchId!==h.branchId||claim.batchId!==h.batchId||!/^MPO:[a-f0-9]{48}$/.test(claim.payoutId||'')||!equal(claim.amount,h.summary.amounts.merchantNet))return fail('PAYOUT_PAID_PROOF_INVALID');
 const journal=await strongGet(db,P,{pk:'MERCHANT_PAYOUT_PAID#'+claim.payoutId,sk:'META'});
 if(journal?.cashLedgerJournalId)await verifyCashPayoutPosting(db,journal);
 if(!journal||journal.batchDigest!==h.batchDigest||journal.ownerId!==ownerId||journal.paidAt!==claim.paidAt||!equal(journal.amount,h.summary.amounts.merchantNet)||journal.orderLines?.length!==saved.lines.length)return fail('PAYOUT_PAID_PROOF_INVALID');
 for(const line of saved.lines){
  const payable=await strongGet(db,H,{orderId:line.orderId,sk:'MERCHANT_PAYABLE'});
  if(!payable||payable.branchId!==h.branchId||payable.orderId!==line.orderId||payable.status!=='PAID'||payable.paidPayoutId!==claim.payoutId||payable.settlementBatchId!==h.batchId||payable.settlementLineDigest!==line.lineDigest||payable.amount!==toWholeIqdExact(readMoney(line.accrual.amounts.merchantNet)))return fail('PAYOUT_PAID_PROOF_INVALID');
  verifyMerchantPayoutJournal(journal,h.branchId,payable);
 }
 return claim;
}
export type PayoutAuthority={actorId:string;owner:boolean;merchantStaff?:boolean;ownerId?:string;businessName?:string;merchantIdentity?:Row;permissions?:string[];guards:Row[]};
/** Manual external payout only. No bank/PSP transport or auto-disbursement exists. */
export function createMerchantPayoutService(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;
 companyCashAuthority?:(action:'READ'|'STAFF'|'APPROVE',amount?:number)=>Promise<PayoutAuthority>;
 authorize:(branchId:string,action:'READ'|'OWNER'|'STAFF'|'APPROVE',amount:number)=>Promise<PayoutAuthority>;
 readBatch:(branchId:string,batchId:string)=>Promise<{header:Row;lines:Row[]}>;
 listBatches:(branchId:string,cursor?:string)=>Promise<Row>;
 readAccount?:(body:Row)=>Promise<Row>;
 otp?:{secret:()=>Promise<string>;send:(phone:string,code:string)=>Promise<void>}}){
 const {db}=options,now=options.now??Date.now,get=(k:Row)=>strongGet(db,P,k);
 const publicRow=(r:Row)=>({payoutId:r.payoutId,batchId:r.batchId,batchDigest:r.batchDigest,branchId:r.branchId,amount:r.amount,method:r.method,destination:r.destinationMasked,recipientName:r.receiptActor?.name||r.recipientName||'مالك المطعم',requestActor:r.requestActor||null,receiptActor:r.receiptActor||null,recipientRoleLabel:r.receiptActor?.roleLabel||r.requestActor?.roleLabel||'مالك',recipientBusinessName:r.receiptActor?.businessName||r.requestActor?.businessName||null,recipientAccountId:r.ownerId,status:r.status,createdAt:r.createdAt,updatedAt:r.updatedAt,version:r.version,executionFee:r.executionFee??null,sourceDebited:r.sourceDebited??null,externalReference:r.externalReference||null,sourceAccount:r.sourceAccount||null,cashbox:r.cashbox||null,cashVoucherNumber:r.method==='CASH'?(r.cashVoucherNumber||cashVoucherNumber(r)):null,executionRecordedBy:r.executionRecordedBy||null,executionRecordedAt:r.executionRecordedAt||null,paidAt:r.paidAt||null,ownerReceiptAt:r.ownerReceiptAt||null,nonReceiptAt:r.nonReceiptAt||null,failureReference:r.failureReference||null,failureReason:r.failureReason||null,reviewReason:r.reviewReason||null});
 async function context(branchId:string,action:'READ'|'OWNER'|'STAFF'|'APPROVE',amount=0){
  if(branchId==='COMPANY_CASHBOOK'&&action!=='OWNER'&&options.companyCashAuthority){const a=await options.companyCashAuthority(action,amount);if(a.owner||a.merchantStaff)return fail('PAYOUT_PERMISSION_REQUIRED');return {...a,ownerId:'COMPANY_CASHBOOK'};}
  if(!id(branchId))return fail('PAYOUT_INVALID_REQUEST');
  const a=await options.authorize(branchId,action,amount),branch=await strongGet(db,B,{businessId:branchId});
  if(!branch||branch.status!=='approved'||!id(branch.ownerId)||branch.ownerId!==branch.cognitoUserId||branch.deletionRequestId!=null||branch.deletedAt!=null||branch.isDeleted===true||a.owner&&a.actorId!==branch.ownerId||action==='OWNER'&&!a.owner&&!a.merchantStaff||['STAFF','APPROVE'].includes(action)&&(a.owner||a.merchantStaff))return fail('PAYOUT_PERMISSION_REQUIRED');
  if(a.merchantStaff&&a.ownerId!==branch.ownerId)return fail('PAYOUT_OWNER_CHANGED');
  const guards=[...a.guards.filter(g=>!(g.ConditionCheck?.TableName===B&&g.ConditionCheck?.Key?.businessId===branchId)),exactCheck(B,{businessId:branchId},branch)];
  for(const k of ['BUSINESS_LIFECYCLE#MERCHANT#'+branchId,'ACCOUNT_LIFECYCLE#MERCHANT#'+branch.ownerId]){
   const d={pk:k,sk:'META'};if(await readMerchantDeletionFence(db,d))return fail('PAYOUT_PARTY_UNAVAILABLE');guards.push({ConditionCheck:{TableName:'staging-AccountDeletion',Key:d,ConditionExpression:'attribute_not_exists(pk)'}});
  }
  return {...a,ownerId:branch.ownerId,businessName:branch.businessName||branch.name||null,guards};
 }
 async function verifyPaidPayout(row:Row,ownerId:string){
  if(row.status!=='PAID')return;
  await verifyCashPayoutPosting(db,row);
  if(row.cashbox){const movement=await get(cashMovementKey(row));if(!movement||movement.status!=='PAID'||movement.payoutId!==row.payoutId||!equal(movement.amount,row.amount)||!equal(movement.cashbox,row.cashbox))return fail('PAYOUT_CASHBOX_REGISTER_PROOF_INVALID');}
  const saved=await options.readBatch(row.branchId,row.batchId),claim=await readMerchantStatementPayment(db,saved,ownerId);
  if(!claim||claim.status!=='PAID'||claim.payoutId!==row.payoutId)return fail('PAYOUT_PAID_PROOF_INVALID');
  const journal=await get({pk:'MERCHANT_PAYOUT_PAID#'+row.payoutId,sk:'META'});
  if(!journal||['branchId','batchId','batchDigest','payoutId','ownerId','amount','method','paidAt','externalReference','sourceAccount','ownerReceiptAt','cashLedgerJournalId','receiptActor'].some(k=>!equal(row[k],journal[k]))||(row.executionFee??0)!==journal.executionFee)return fail('PAYOUT_PAID_PROOF_INVALID');
 }
 // Expiry fences use the time of each fresh check; identity and persisted versions must still match.
 const authoritySnapshot=(a:Row)=>a.merchantStaff?{...a,guards:a.guards.map((g:Row)=>{const c=g.ConditionCheck;if(!c?.ExpressionAttributeValues)return g;return {ConditionCheck:{...c,ExpressionAttributeValues:Object.fromEntries(Object.entries(c.ExpressionAttributeValues).map(([k,v])=>[k,k===':now'||/^:g[0-9]+x[0-9]+_now$/.test(k)?'FRESH_EXPIRY_CHECK':v]))}};})}:a;
 async function write(branchId:string,action:'OWNER'|'STAFF'|'APPROVE',a:Awaited<ReturnType<typeof context>>,operations:Row[],amount=0){
  const after=await context(branchId,action,amount);if(!equal(authoritySnapshot(a),authoritySnapshot(after)))return fail('PAYOUT_AUTHORIZATION_CHANGED');
  if(operations.length+after.guards.length>100||Buffer.byteLength(JSON.stringify(operations))>2500000)return fail('PAYOUT_LIMIT_EXCEEDED');
  if(after.merchantStaff&&after.merchantIdentity){const at=new Date(now()).toISOString();operations.push(put(P,{pk:'BRANCH#'+branchId,sk:'STAFF_AUDIT#SETTLEMENT#'+at+'#'+quoteHash(operations).slice(0,40),kind:'MERCHANT_STAFF_SETTLEMENT_ACTION',businessId:branchId,ownerId:after.ownerId,actorId:after.actorId,actorName:after.merchantIdentity.name,roleName:after.merchantIdentity.roleLabel,roleId:after.merchantIdentity.role,membershipVersion:after.merchantIdentity.membershipVersion,policyVersion:after.merchantIdentity.policyVersion,deviceId:after.merchantIdentity.deviceId,action:operations.find(o=>o.Put?.Item?.kind==='MERCHANT_PAYOUT_EVENT')?.Put.Item.action||operations.find(o=>o.Put?.TableName==='staging-AuditLog')?.Put.Item.action||'PAYOUT_'+action,createdAt:at,result:'SUCCEEDED'}));}
  await db.send(new TransactWriteCommand({TransactItems:cashAccountingDeduplicate([...after.guards,...operations]) as any,ClientRequestToken:quoteHash(operations).slice(0,36)}));
 }
 const audit=(branchId:string,payoutId:string,actorId:string,action:string,requestId:string)=>put('staging-AuditLog',{datePartition:'date#'+new Date(now()).toISOString().slice(0,10).replace(/-/g,''),sk:'PAYOUT#'+payoutId+'#'+requestId,action:'MERCHANT_PAYOUT_'+action,branchId,payoutId,actorId,createdAt:new Date(now()).toISOString()});
 async function batch(branchId:string,batchId:string){const b=await options.readBatch(branchId,batchId);const approval=await readMerchantStatementApproval(db,branchId,batchId,b.header.batchDigest);if(!approval)return fail('PAYOUT_STATEMENT_APPROVAL_REQUIRED');if(b.lines.length<1||b.lines.length>10)return fail('PAYOUT_LIMIT_EXCEEDED');const amount=toWholeIqdExact(readMoney(b.header.summary.amounts.merchantNet));if(amount<=0)return fail('PAYOUT_POSITIVE_AMOUNT_REQUIRED');return {...b,approval,amount};}
 async function request(v:Row){
  if(!['CASH','ZAIN_CASH'].includes(v.method)||!uuid(v.requestId)||!/^MSB:[a-f0-9]{48}$/.test(v.batchId||'')||! /^[a-f0-9]{64}$/.test(v.batchDigest||'')||Object.keys(v).some(k=>!['action','branchId','requestId','batchId','batchDigest','method','destinationProofId'].includes(k))||v.method==='CASH'&&v.destinationProofId)return fail('PAYOUT_INVALID_REQUEST');
  const a=await context(v.branchId,'OWNER'),payoutId='MPO:'+quoteHash({branchId:v.branchId,ownerId:a.actorId,requestId:v.requestId}).slice(0,48),k=key(v.branchId,payoutId),digest=quoteHash(v),prior=await get(k);
  if(prior){if(prior.requestDigest!==digest||prior.ownerId!==a.ownerId)return fail('PAYOUT_REQUEST_ID_CONFLICT');return {payout:publicRow(prior),replayed:true};}
  const b=await batch(v.branchId,v.batchId);if(b.header.batchDigest!==v.batchDigest)return fail('PAYOUT_STATEMENT_CHANGED');
  const claimKey=key(v.branchId,'BATCH#'+v.batchId),claim=await get(claimKey);if(claim&&!['CANCELLED','FAILED_NOT_PAID'].includes(claim.status))return fail('PAYOUT_STATEMENT_ALREADY_CLAIMED');
  const proofKey=destinationKey(v.branchId,a.ownerId),proof=v.method==='ZAIN_CASH'?await get(proofKey):null;
  if(v.method==='ZAIN_CASH'&&(!proof||proof.proofId!==v.destinationProofId||proof.status!=='VERIFIED'||proof.ownerId!==a.ownerId||proof.expiresAt<=now()/1000))return fail('PAYOUT_DESTINATION_VERIFICATION_REQUIRED');
  const recipientKey={pk:'PERSON#'+a.actorId,sk:'PROFILE'},recipient=(await db.send(new GetCommand({TableName:P,Key:recipientKey,ConsistentRead:true,ProjectionExpression:'#p,#s,#n,#v',ExpressionAttributeNames:{'#p':'pk','#s':'sk','#n':'name','#v':'version'}}))).Item;
  const at=new Date(now()).toISOString(),row={...k,schemaVersion:1,kind:'MERCHANT_PAYOUT',payoutId,branchId:v.branchId,ownerId:a.ownerId,requestActor:a.merchantIdentity||{subjectId:a.actorId,name:typeof recipient?.name==='string'?recipient.name:'مالك المطعم',role:'OWNER',roleLabel:'مالك',businessId:v.branchId,businessName:a.businessName,ownerId:a.ownerId},recipientName:typeof recipient?.name==='string'?recipient.name.slice(0,120):'مالك المطعم',batchId:v.batchId,batchDigest:v.batchDigest,amount:b.header.summary.amounts.merchantNet,method:v.method,destinationMasked:proof?masked(proof.phone):'مالك المطعم',requestDigest:digest,status:'UNDER_REVIEW',version:1,createdAt:at,updatedAt:at,retentionClass:'FINANCIAL_SETTLEMENT'};
  const operations=[put(P,row),put(P,{...claimKey,kind:'MERCHANT_PAYOUT_CLAIM',branchId:v.branchId,batchId:v.batchId,payoutId,status:'ACTIVE',amount:row.amount},claim||undefined),exactCheck(P,{pk:b.header.pk,sk:b.header.sk},b.header),exactCheck(P,{pk:b.approval.pk,sk:b.approval.sk},b.approval),audit(v.branchId,payoutId,a.actorId,'REQUESTED',v.requestId)];
  if(recipient)operations.push(exactCheck(P,recipientKey,recipient));
  for(const line of b.lines){const q={orderId:line.orderId,sk:'MERCHANT_PAYABLE'},payable=await strongGet(db,H,q);if(!payable||payable.status!=='LOCKED_PENDING_SETTLEMENT'||payable.branchId!==v.branchId||payable.amount!==toWholeIqdExact(readMoney(line.accrual.amounts.merchantNet))||payable.settlementBatchId!==v.batchId||payable.settlementLineDigest!==line.lineDigest)return fail('PAYOUT_PAYABLE_CHANGED');operations.push(exactCheck(H,q,payable),exactCheck(P,{pk:line.pk,sk:line.sk},line));}
  if(proof)operations.push(put(P,{...key(v.branchId,'PRIVATE#'+payoutId),kind:'MERCHANT_PAYOUT_DESTINATION',branchId:v.branchId,payoutId,ownerId:a.ownerId,phone:proof.phone,verifiedAt:proof.verifiedAt,proofId:proof.proofId,retentionClass:'FINANCIAL_SETTLEMENT'}),put(P,{...proof,status:'CONSUMED',payoutId,version:proof.version+1},proof));
  try{await write(v.branchId,'OWNER',a,operations);}catch(e){const saved=await get(k);if(saved?.requestDigest===digest)return {payout:publicRow(saved),replayed:true};throw e;}
  return {payout:publicRow(row)};
 }
 async function destination(v:Row){
  if(Object.keys(v).some(k=>!['action','branchId','requestId','phone','proofId','code'].includes(k)))return fail('PAYOUT_INVALID_REQUEST');
  const a=await context(v.branchId,'OWNER');if(!options.otp)return fail('PAYOUT_DESTINATION_SERVICE_UNAVAILABLE');
  const k=destinationKey(v.branchId,a.actorId),old=await get(k),secret=await options.otp.secret();
  const hash=(proofId:string,code:string)=>createHmac('sha256',secret).update('merchant-payout-destination\0'+v.branchId+'\0'+a.actorId+'\0'+proofId+'\0'+code).digest('hex');
  if(v.action==='START_PAYOUT_DESTINATION'){
   const n=phone(v.phone);if(!uuid(v.requestId))return fail('PAYOUT_INVALID_REQUEST');
   if(old&&old.requestId===v.requestId){if(old.phone!==n)return fail('PAYOUT_REQUEST_ID_CONFLICT');return {proofId:old.proofId,status:old.status,destination:masked(n)};}
   if(old&&((old.lastSentAt>now()-60000)||(old.rateWindow>now()-3600000&&old.sendCount>=5)))return fail('PAYOUT_DESTINATION_RATE_LIMIT');
   const proofId='MPD:'+quoteHash({ownerId:a.actorId,branchId:v.branchId,requestId:v.requestId}).slice(0,48),code=String(randomInt(1000000)).padStart(6,'0');
   const row={...k,kind:'MERCHANT_PAYOUT_DESTINATION_CHALLENGE',branchId:v.branchId,ownerId:a.actorId,requestId:v.requestId,proofId,phone:n,codeHash:hash(proofId,code),attempts:0,status:'CODE_SENT',expiresAt:Math.floor(now()/1000)+300,lastSentAt:now(),rateWindow:old&&old.rateWindow>now()-3600000?old.rateWindow:now(),sendCount:old&&old.rateWindow>now()-3600000?old.sendCount+1:1,version:(old?.version||0)+1};
   await write(v.branchId,'OWNER',a,[put(P,row,old||undefined)]);await options.otp.send(n,code);
   return {proofId,destination:masked(n),status:'CODE_SENT'};
  }
  if(!old||old.ownerId!==a.actorId||old.proofId!==v.proofId||old.expiresAt<=now()/1000||old.status!=='VERIFIED'&&old.attempts>=5||!/^\d{6}$/.test(v.code||''))return fail('PAYOUT_DESTINATION_EXPIRED');
  if(old.status==='VERIFIED')return {proofId:old.proofId,status:'VERIFIED',destination:masked(old.phone)};
  if(old.status!=='CODE_SENT')return fail('PAYOUT_DESTINATION_EXPIRED');
  const ok=timingSafeEqual(Buffer.from(old.codeHash,'hex'),Buffer.from(hash(old.proofId,v.code),'hex'));
  const row={...old,attempts:old.attempts+1,version:old.version+1,...(ok?{status:'VERIFIED',verifiedAt:new Date(now()).toISOString(),expiresAt:Math.floor(now()/1000)+600}:{})};
  await write(v.branchId,'OWNER',a,[put(P,row,old)]);if(!ok)return fail('PAYOUT_INVALID_CODE');return {proofId:old.proofId,status:'VERIFIED',destination:masked(old.phone)};
 }
 async function transition(v:Row){
  const actions:Row={APPROVE_PAYOUT:['UNDER_REVIEW','APPROVED','APPROVE'],BEGIN_PAYOUT:['APPROVED','PROCESSING','STAFF'],RECORD_PAYOUT_EXECUTION:[['PROCESSING','RECONCILIATION_REQUIRED'],'AWAITING_RECEIPT','STAFF'],REOPEN_PAYOUT_RECEIPT:[['RECONCILIATION_REQUIRED','NON_RECEIPT_CONFIRMED'],'AWAITING_RECEIPT','APPROVE'],ACK_PAYOUT_RECEIPT:['AWAITING_RECEIPT','RECEIPT_CONFIRMED','OWNER'],RECONCILE_PAYOUT:['RECEIPT_CONFIRMED','PAID','APPROVE'],ACK_PAYOUT_NOT_RECEIVED:['RECONCILIATION_REQUIRED','NON_RECEIPT_CONFIRMED','OWNER'],RESOLVE_PAYOUT_NOT_PAID:['NON_RECEIPT_CONFIRMED','FAILED_NOT_PAID','APPROVE'],CANCEL_PAYOUT:[['UNDER_REVIEW','APPROVED'],'CANCELLED','OWNER'],REPORT_PAYOUT_PROBLEM:[['PROCESSING','AWAITING_RECEIPT','RECEIPT_CONFIRMED'],'RECONCILIATION_REQUIRED','OWNER']};
  const rule=actions[v.action];if(!rule||!uuid(v.requestId)||!/^MPO:[a-f0-9]{48}$/.test(v.payoutId||'')||Object.keys(v).some(k=>!['action','branchId','requestId','payoutId','version','externalReference','sourceAccount','actualAmount','destinationConfirmed','receivedAmount','accepted','reason','failureReference','confirmedNoDebit','executionFee','cashboxId','cashboxOverrideReason'].includes(k)))return fail('PAYOUT_INVALID_REQUEST');
  const k=key(v.branchId,v.payoutId),row=await get(k);if(!row||row.kind!=='MERCHANT_PAYOUT'||row.branchId!==v.branchId)return fail('PAYOUT_UNAVAILABLE');
  const amount=toWholeIqdExact(readMoney(row.amount)),a=await context(v.branchId,rule[2],amount+(row.executionFee||0));if(row.ownerId!==a.ownerId)return fail('PAYOUT_OWNER_CHANGED');
  const eventKey=key(v.branchId,'EVENT#'+v.payoutId+'#'+v.requestId),eventDigest=quoteHash(v),previous=await get(eventKey);
  if(previous){if(previous.requestDigest!==eventDigest||previous.actorId!==a.actorId)return fail('PAYOUT_REQUEST_ID_CONFLICT');return {payout:publicRow(row),replayed:true};}
  if(!Number.isSafeInteger(row.version)||row.version<1||row.version>=Number.MAX_SAFE_INTEGER||row.version!==v.version||!(Array.isArray(rule[0])?rule[0]:[rule[0]]).includes(row.status))return fail('PAYOUT_STATE_CHANGED');
  const at=new Date(now()).toISOString(),next:Row={...row,status:rule[1],version:row.version+1,updatedAt:at},ops:Row[]=[];
  if(v.action==='APPROVE_PAYOUT'){const b=await batch(v.branchId,row.batchId);if(b.header.batchDigest!==row.batchDigest||b.amount!==amount)return fail('PAYOUT_STATEMENT_CHANGED');next.approvedBy=a.actorId;next.approvedAt=at;ops.push(exactCheck(P,{pk:b.approval.pk,sk:b.approval.sk},b.approval));}
  if(v.action==='BEGIN_PAYOUT'){next.executedBy=a.actorId;next.executionStartedAt=at;if(row.method==='CASH')next.cashVoucherNumber=cashVoucherNumber(row);}
  if(v.action==='RECORD_PAYOUT_EXECUTION'){
   if(row.externalReference)return fail('PAYOUT_EXECUTION_ALREADY_RECORDED');
   if(v.actualAmount!==amount||v.destinationConfirmed!==true)return fail('PAYOUT_EXECUTION_PROOF_REQUIRED');
   const fee=v.executionFee??0;if(!Number.isSafeInteger(fee)||fee<0||!Number.isSafeInteger(amount+fee)||row.method==='CASH'&&fee!==0)return fail('PAYOUT_EXECUTION_PROOF_REQUIRED');next.executionFee=fee;next.sourceDebited=amount+fee;next.executionRecordedAt=at;
   if(row.method==='CASH'){
    if(!cashboxCode(v.cashboxId)||v.externalReference!==undefined||v.sourceAccount!==undefined)return fail('PAYOUT_REGISTERED_CASHBOX_REQUIRED');
    const box=await get(cashboxKey(v.cashboxId));if(!box||box.kind!=='MERCHANT_CASHBOX'||box.status!=='ACTIVE'||box.code!==v.cashboxId||!Number.isSafeInteger(box.version))return fail('PAYOUT_CASHBOX_UNAVAILABLE');
    next.sourceAccount=box.code;next.externalReference=cashVoucherNumber(row);next.cashVoucherNumber=next.externalReference;next.cashbox={code:box.code,name:box.name,custodian:box.custodian,location:box.location,version:box.version,custodianEmployeeId:box.custodianEmployeeId};
    const posting=await cashPayoutPosting(db,next,a.actorId,at,false,v.cashboxOverrideReason);next.cashLedgerJournalId=posting.journalId;ops.push(...posting.ops);
    ops.push(exactCheck(P,cashboxKey(box.code),box),put(P,{...cashMovementKey(next),kind:'MERCHANT_CASH_DISBURSEMENT',schemaVersion:1,version:1,branchId:row.branchId,payoutId:row.payoutId,batchId:row.batchId,batchDigest:row.batchDigest,voucherNumber:next.externalReference,cashbox:next.cashbox,ownerId:row.ownerId,recipientName:row.recipientName,amount:row.amount,status:'AWAITING_RECEIPT',executedBy:a.actorId,executedAt:at,updatedAt:at,retentionClass:'FINANCIAL_SETTLEMENT'}));
   }else{
    if(v.cashboxId!==undefined||typeof v.externalReference!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$/.test(v.externalReference)||typeof v.sourceAccount!=='string'||! /^[A-Za-z][A-Za-z0-9._:/-]{2,79}$/.test(v.sourceAccount))return fail('PAYOUT_EXECUTION_PROOF_REQUIRED');
    next.externalReference=v.externalReference.toUpperCase();next.sourceAccount=v.sourceAccount.toUpperCase();
   }
   next.executionRecordedBy=a.actorId;next.executionRecordedAt=at;
   ops.push(put(P,{pk:'MERCHANT_PAYOUT_REFERENCE#'+quoteHash({method:row.method,source:row.method==='CASH'?next.sourceAccount:'ZAIN_CASH',reference:next.externalReference}),sk:'META',kind:'MERCHANT_PAYOUT_REFERENCE',branchId:v.branchId,payoutId:row.payoutId,method:row.method,externalReference:next.externalReference,sourceAccount:next.sourceAccount,createdAt:at,retentionClass:'FINANCIAL_SETTLEMENT'}));
  }
  if(v.action==='ACK_PAYOUT_RECEIPT'){if(v.accepted!==true||v.receivedAmount!==amount)return fail('PAYOUT_RECEIPT_AMOUNT_MISMATCH');next.receiptOwnerId=row.ownerId;next.ownerReceiptAt=at;if(a.merchantIdentity)next.receiptActor={...a.merchantIdentity,confirmedAt:at};else {const recipientKey={pk:'PERSON#'+a.actorId,sk:'PROFILE'},person=(await db.send(new GetCommand({TableName:P,Key:recipientKey,ConsistentRead:true,ProjectionExpression:'pk,sk,#name,#version',ExpressionAttributeNames:{'#name':'name','#version':'version'}}))).Item;const name=person?.name||(!row.requestActor||row.requestActor.subjectId===a.actorId?row.recipientName:null);if(typeof name!=='string'||!name.trim())return fail('PAYOUT_RECIPIENT_PROFILE_REQUIRED');if(person)ops.push(exactCheck(P,recipientKey,person));next.receiptActor={subjectId:a.actorId,name,role:'OWNER',roleLabel:'مالك',businessId:v.branchId,businessName:a.businessName,ownerId:row.ownerId,confirmedAt:at};}}
  if(v.action==='REPORT_PAYOUT_PROBLEM'){if(typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>300)return fail('PAYOUT_REVIEW_REASON_REQUIRED');next.reviewReason=v.reason.trim();next.reviewRaisedAt=at;}
  if(v.action==='REOPEN_PAYOUT_RECEIPT'){if(!row.externalReference||!row.sourceAccount||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>300)return fail('PAYOUT_REVIEW_REASON_REQUIRED');next.reviewResolution=v.reason.trim();next.reviewResolvedBy=a.actorId;delete next.ownerReceiptAt;delete next.receiptOwnerId;delete next.receiptActor;}
  if(v.action==='ACK_PAYOUT_NOT_RECEIVED'){if(v.accepted!==true||v.receivedAmount!==0)return fail('PAYOUT_NON_RECEIPT_REQUIRED');next.nonReceiptOwnerId=row.ownerId;if(a.merchantIdentity)next.nonReceiptActor=a.merchantIdentity;next.nonReceiptAt=at;}
  if(v.action==='RESOLVE_PAYOUT_NOT_PAID'){if(row.nonReceiptOwnerId!==row.ownerId||!row.nonReceiptAt||v.confirmedNoDebit!==true||v.actualAmount!==0||typeof v.failureReference!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$/.test(v.failureReference)||typeof v.sourceAccount!=='string'||! /^[A-Za-z][A-Za-z0-9._:/-]{2,79}$/.test(v.sourceAccount)||row.sourceAccount&&row.sourceAccount!==v.sourceAccount.toUpperCase()||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>300)return fail('PAYOUT_FINAL_FAILURE_PROOF_REQUIRED');next.failureReference=v.failureReference.toUpperCase();next.failureSource=v.sourceAccount.toUpperCase();next.failureReason=v.reason.trim();next.failureResolvedBy=a.actorId;next.failureResolvedAt=at;}
  const claimKey=key(v.branchId,'BATCH#'+row.batchId),claim=await get(claimKey);if(!claim||claim.payoutId!==row.payoutId||claim.status!=='ACTIVE')return fail('PAYOUT_CLAIM_CHANGED');
  if(['CANCEL_PAYOUT','RESOLVE_PAYOUT_NOT_PAID'].includes(v.action))ops.push(put(P,{...claim,status:next.status},claim));
  else if(v.action==='RECONCILE_PAYOUT'){
   if(row.cashLedgerJournalId){const proof=await verifyCashPayoutPosting(db,row);if(proof)ops.push(exactCheck(P,{pk:proof.pk,sk:proof.sk},proof));}
   if(row.receiptActor&&(row.receiptActor.ownerId!==row.ownerId||row.receiptActor.businessId!==v.branchId||!row.receiptActor.subjectId||!row.receiptActor.name||!row.receiptActor.roleLabel))return fail('PAYOUT_RECEIPT_REQUIRED');
   if(row.receiptOwnerId!==row.ownerId||!row.ownerReceiptAt||!row.externalReference||!row.sourceAccount)return fail('PAYOUT_RECEIPT_REQUIRED');
   const b=await batch(v.branchId,row.batchId);if(b.header.batchDigest!==row.batchDigest||b.amount!==amount)return fail('PAYOUT_STATEMENT_CHANGED');
   const walletKey={walletId:'WALLET#MERCHANT#'+v.branchId,sk:'META'},w=await strongGet(db,W,walletKey);
   if(!w||w.ownerId!==v.branchId||w.ownerType!=='MERCHANT'||w.currency!=='IQD'||w.status!=='ACTIVE'||w.deletionRequestId!=null||w.deletedAt!=null||w.isDeleted===true||!Number.isSafeInteger(w.lockedBalance)||w.lockedBalance<amount||!Number.isSafeInteger(w.availableBalance)||w.availableBalance<0||!Number.isSafeInteger(w.version)||w.version<1||w.version>=Number.MAX_SAFE_INTEGER)return fail('PAYOUT_LIABILITY_UNAVAILABLE');
   const orderLines=[];for(const line of b.lines){const q={orderId:line.orderId,sk:'MERCHANT_PAYABLE'},payable=await strongGet(db,H,q);const value=toWholeIqdExact(readMoney(line.accrual.amounts.merchantNet));if(!payable||payable.status!=='LOCKED_PENDING_SETTLEMENT'||payable.branchId!==v.branchId||payable.amount!==value||payable.settlementBatchId!==row.batchId||payable.settlementLineDigest!==line.lineDigest)return fail('PAYOUT_PAYABLE_CHANGED');orderLines.push({orderId:line.orderId,amount:value,lineDigest:line.lineDigest});ops.push(setFields(exactCheck(H,q,payable),{status:'PAID',paidPayoutId:row.payoutId,paidAt:at}),exactCheck(P,{pk:line.pk,sk:line.sk},line));}
   if(orderLines.reduce((s,l)=>s+l.amount,0)!==amount)return fail('PAYOUT_TOTAL_MISMATCH');
   next.paidAt=at;next.reconciledBy=a.actorId;
   ops.push(setFields(exactCheck(W,walletKey,w,[...Object.keys(w),'deletionRequestId','deletedAt','isDeleted']),{lockedBalance:w.lockedBalance-amount,version:w.version+1,updatedAt:at}),put(P,{...claim,status:'PAID',paidAt:at},claim),exactCheck(P,{pk:b.header.pk,sk:b.header.sk},b.header),exactCheck(P,{pk:b.approval.pk,sk:b.approval.sk},b.approval));
   const journal=seal({pk:'MERCHANT_PAYOUT_PAID#'+row.payoutId,sk:'META',schemaVersion:1,kind:'MERCHANT_PAYOUT_PAID_JOURNAL',status:'PAID',branchId:v.branchId,payoutId:row.payoutId,batchId:row.batchId,batchDigest:row.batchDigest,ownerId:row.ownerId,receiptOwnerId:row.receiptOwnerId,ownerReceiptAt:row.ownerReceiptAt,...(row.receiptActor?{receiptActor:row.receiptActor}:{}),amount:row.amount,method:row.method,externalReference:row.externalReference,sourceAccount:row.sourceAccount,...(row.cashbox?{cashbox:row.cashbox,cashVoucherNumber:row.cashVoucherNumber}:{}),...(row.cashLedgerJournalId?{cashLedgerJournalId:row.cashLedgerJournalId,executionRecordedAt:row.executionRecordedAt}:{}),paidAt:at,reconciledBy:a.actorId,orderLines,executionFee:row.executionFee??0,debit:amount+(row.executionFee||0),credit:amount+(row.executionFee||0),lines:[{account:'MERCHANT_PAYABLE',side:'DEBIT',amount},...(row.executionFee?[{account:'PAYOUT_FEE_EXPENSE',side:'DEBIT',amount:row.executionFee}]:[]),{account:row.method==='CASH'?(row.cashLedgerJournalId?'MERCHANT_DISBURSEMENT_CLEARING':'CASH_DISBURSEMENT'):'ZAIN_CASH_DISBURSEMENT',side:'CREDIT',amount:amount+(row.executionFee||0)}],retentionClass:'FINANCIAL_SETTLEMENT'});
   ops.push(put(P,journal),put(L,{walletId:w.walletId,sk:'ts#'+at+'#PAYOUT#'+row.payoutId,transactionId:row.payoutId,type:'DEBIT',category:'MERCHANT_PAYOUT_PAID',amount:-amount,balanceBefore:w.lockedBalance,balanceAfter:w.lockedBalance-amount,relatedEntityId:row.payoutId,relatedEntityType:'MERCHANT_PAYOUT',createdAt:at,metadata:{branchId:v.branchId,payoutId:row.payoutId,balanceType:'LOCKED',journalDigest:journal.digest}}));
  }else ops.push(exactCheck(P,claimKey,claim));
  if(v.action==='RESOLVE_PAYOUT_NOT_PAID'&&row.cashLedgerJournalId){const posting=await cashPayoutPosting(db,{...row,...next},a.actorId,at,true);next.cashReturnJournalId=posting.journalId;ops.push(...posting.ops);}
  if(row.method==='CASH'&&row.cashbox&&row.externalReference&&['ACK_PAYOUT_RECEIPT','REPORT_PAYOUT_PROBLEM','ACK_PAYOUT_NOT_RECEIVED','REOPEN_PAYOUT_RECEIPT','RESOLVE_PAYOUT_NOT_PAID','RECONCILE_PAYOUT'].includes(v.action)){
   const movement=await get(cashMovementKey(row));if(!movement||movement.payoutId!==row.payoutId||movement.voucherNumber!==row.externalReference||!equal(movement.amount,row.amount)||!equal(movement.cashbox,row.cashbox))return fail('PAYOUT_CASHBOX_REGISTER_PROOF_INVALID');
   ops.push(put(P,{...movement,status:next.status,version:movement.version+1,updatedAt:at,updatedBy:a.actorId,...(next.paidAt?{paidAt:next.paidAt}:{}),...(next.failureReference?{failureReference:next.failureReference,failureReason:next.failureReason}:{})},movement));
  }
  ops.push(put(P,next,row),put(P,{...eventKey,kind:'MERCHANT_PAYOUT_EVENT',branchId:v.branchId,payoutId:row.payoutId,actorId:a.actorId,action:v.action,...(a.merchantIdentity?{merchantActor:a.merchantIdentity}:{}),requestDigest:eventDigest,from:row.status,to:next.status,createdAt:at,retentionClass:'FINANCIAL_SETTLEMENT'}),audit(v.branchId,row.payoutId,a.actorId,v.action,v.requestId));
  try{await write(v.branchId,rule[2],a,ops,amount+(row.executionFee||0));}catch(e){const committed=await get(eventKey);if(committed?.requestDigest===eventDigest&&committed.actorId===a.actorId){const saved=await get(k);if(!saved)return fail('PAYOUT_OUTCOME_UNKNOWN_RETRY_SAME_REQUEST');return {payout:publicRow(saved),replayed:true};}throw e;}
  return {payout:publicRow(next)};
 }
 async function cashboxAct(v:Row){
  if(Object.keys(v).sort().join(',')!==(v.action==='CREATE_CASHBOX'?'action,branchId,code,custodianEmployeeId,location,name,reason,requestId,status':'action,branchId,code,custodianEmployeeId,location,name,reason,requestId,status,version')||!uuid(v.requestId))return fail('PAYOUT_CASHBOX_INVALID');
  const a=await context(v.branchId,'APPROVE');const assigned=await cashboxCustodian(db,v.custodianEmployeeId);validateCashbox({...v,custodian:cashEmployeeName(assigned)});const k=cashboxKey(v.code),prior=await get(k),event={pk:'MERCHANT_CASHBOX#'+v.code,sk:'EVENT#'+v.requestId},digest=quoteHash(v),old=await get(event);
  if(old){if(old.requestDigest!==digest||old.actorId!==a.actorId)return fail('PAYOUT_REQUEST_ID_CONFLICT');return {cashbox:prior,replayed:true};}
  if(v.action==='CREATE_CASHBOX'?!!prior:!prior||prior.version!==v.version)return fail('PAYOUT_CASHBOX_CHANGED');
  if(prior&&prior.custodianEmployeeId!==v.custodianEmployeeId&&await get(cashBalanceKey(v.code)))return fail('PAYOUT_CASH_HANDOVER_REQUIRED');
  const at=new Date(now()).toISOString(),box={...k,kind:'MERCHANT_CASHBOX',schemaVersion:1,code:v.code,name:v.name.trim(),custodian:cashEmployeeName(assigned),custodianEmployeeId:assigned.employeeId,location:v.location.trim(),status:v.status,version:(prior?.version||0)+1,createdAt:prior?.createdAt||at,createdBy:prior?.createdBy||a.actorId,updatedAt:at,updatedBy:a.actorId,retentionClass:'FINANCIAL_SETTLEMENT'};
  await write(v.branchId,'APPROVE',a,[cashEmployeeGuard(assigned),put(P,box,prior||undefined),put(P,{...event,kind:'MERCHANT_CASHBOX_EVENT',requestDigest:digest,actorId:a.actorId,action:v.action,reason:v.reason.trim(),before:prior||null,after:box,createdAt:at,retentionClass:'FINANCIAL_SETTLEMENT'}),audit(v.branchId,v.code,a.actorId,v.action,v.requestId)]);
  return {cashbox:box};
 }
 const accounting=createCashboxAccountingService({db,now,authorize:context,commit:(branch,action,a,ops,n)=>write(branch,action,a as any,ops,n)});
 return {
  async merchantContext(v:Row){if(Object.keys(v).join(',')!=='branchId')return fail('PAYOUT_INVALID_REQUEST');const a=await context(v.branchId,'READ');if(!a.merchantStaff)return fail('PAYOUT_PERMISSION_REQUIRED');const proof=await get(destinationKey(v.branchId,a.ownerId)),destination=proof?.status==='VERIFIED'&&proof.ownerId===a.ownerId&&proof.expiresAt>now()/1000?{proofId:proof.proofId,maskedPhone:masked(proof.phone)}:null;await context(v.branchId,'READ');return {actor:a.merchantIdentity,can:{request:a.permissions?.includes('finance.payout.request')===true,receive:a.permissions?.includes('finance.payout.receive')===true},methods:destination?['CASH','ZAIN_CASH']:['CASH'],destination};},
  cashAccount:accounting.account,cashList:accounting.list,cashCustodians:accounting.custodians,
  async cashboxes(v:Row){if(Object.keys(v).some(k=>!['branchId','cursor'].includes(k)))return fail('PAYOUT_INVALID_REQUEST');const a=await context(v.branchId,'READ');if(a.owner||a.merchantStaff)return fail('PAYOUT_PERMISSION_REQUIRED');let cursor;if(v.cursor){try{cursor=JSON.parse(Buffer.from(v.cursor,'base64url').toString());if(cursor.pk!==cashboxDirectory||!/^BOX#[A-Z][A-Z0-9-]{2,39}$/.test(cursor.sk)||Object.keys(cursor).sort().join(',')!=='pk,sk')throw Error();}catch{return fail('PAYOUT_INVALID_CURSOR');}}
   const out=await db.send(new QueryCommand({TableName:P,ConsistentRead:true,Limit:25,KeyConditionExpression:'pk=:pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':cashboxDirectory,':prefix':'BOX#'},...(cursor?{ExclusiveStartKey:cursor}:{})}));if(!equal(a,await context(v.branchId,'READ')))return fail('PAYOUT_AUTHORIZATION_CHANGED');return {items:out.Items||[],nextCursor:out.LastEvaluatedKey?Buffer.from(JSON.stringify(out.LastEvaluatedKey)).toString('base64url'):null};},
  async cashboxRegister(v:Row){if(Object.keys(v).some(k=>!['branchId','code','cursor'].includes(k))||!cashboxCode(v.code))return fail('PAYOUT_INVALID_REQUEST');const a=await context(v.branchId,'READ');if(a.owner||a.merchantStaff)return fail('PAYOUT_PERMISSION_REQUIRED');const box=await get(cashboxKey(v.code));if(!box)return fail('PAYOUT_CASHBOX_UNAVAILABLE');let cursor;if(v.cursor){try{cursor=JSON.parse(Buffer.from(v.cursor,'base64url').toString());if(cursor.pk!=='MERCHANT_CASHBOX#'+v.code||typeof cursor.sk!=='string'||!cursor.sk.startsWith('VOUCHER#')||cursor.sk.length>150||Object.keys(cursor).sort().join(',')!=='pk,sk')throw Error();}catch{return fail('PAYOUT_INVALID_CURSOR');}}
   const out=await db.send(new QueryCommand({TableName:P,ConsistentRead:true,Limit:25,ScanIndexForward:false,KeyConditionExpression:'pk=:pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':'MERCHANT_CASHBOX#'+v.code,':prefix':'VOUCHER#'},...(cursor?{ExclusiveStartKey:cursor}:{})}));if(!equal(a,await context(v.branchId,'READ')))return fail('PAYOUT_AUTHORIZATION_CHANGED');return {cashbox:box,items:out.Items||[],coverage:'CURRENT_PAGE_MERCHANT_DISBURSEMENTS_ONLY',generatedAt:new Date(now()).toISOString(),nextCursor:out.LastEvaluatedKey?Buffer.from(JSON.stringify(out.LastEvaluatedKey)).toString('base64url'):null};},
  async account(v:Row){const before=await context(v?.branchId,'READ');if(!options.readAccount)return fail('PAYOUT_ACCOUNT_UNAVAILABLE');const result=await options.readAccount(v);if(!equal(before,await context(v.branchId,'READ')))return fail('PAYOUT_AUTHORIZATION_CHANGED');return result;},
  async list(v:Row){if(Object.keys(v).some(k=>!['branchId','cursor'].includes(k)))return fail('PAYOUT_INVALID_REQUEST');await context(v.branchId,'READ');let cursor;if(v.cursor){try{const c=JSON.parse(Buffer.from(v.cursor,'base64url').toString());if(c.pk!==pk(v.branchId)||!/^MPO:[a-f0-9]{48}$/.test(c.sk)||Object.keys(c).sort().join(',')!=='pk,sk')return fail('PAYOUT_INVALID_CURSOR');cursor=c;}catch{return fail('PAYOUT_INVALID_CURSOR');}}
   const q=await db.send(new QueryCommand({TableName:P,ConsistentRead:true,KeyConditionExpression:'pk=:pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':pk(v.branchId),':prefix':'MPO:'},ScanIndexForward:false,Limit:20,...(cursor?{ExclusiveStartKey:cursor}:{})}));const after=await context(v.branchId,'READ');for(const row of q.Items||[])await verifyPaidPayout(row,after.ownerId);await context(v.branchId,'READ');return {items:(q.Items||[]).map(publicRow),nextCursor:q.LastEvaluatedKey?Buffer.from(JSON.stringify(q.LastEvaluatedKey)).toString('base64url'):null};},
  async statement(v:Row){
   if(!v||Object.keys(v).sort().join(',')!=='batchId,branchId'||!/^MSB:[a-f0-9]{48}$/.test(v.batchId||''))return fail('PAYOUT_INVALID_REQUEST');
   const before=await context(v.branchId,'READ'),saved=await options.readBatch(v.branchId,v.batchId);
   const approval=await readMerchantStatementApproval(db,v.branchId,v.batchId,saved.header.batchDigest);
   const fields=['merchantExceptionCompensation','goodsGross','merchantFundedDiscount','platformFundedDiscount','merchantGoodsEntitlement','merchantCommission','merchantOtherCharges','merchantDeliverySupport','merchantNet'];
   const amounts=(row:Row)=>Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
   const claim=await readMerchantStatementPayment(db,saved,before.ownerId);
   if(!equal(before,await context(v.branchId,'READ')))return fail('PAYOUT_AUTHORIZATION_CHANGED');
   const printLines=[];for(const line of saved.lines){const order=(await db.send(new GetCommand({TableName:'WizzOrders',Key:{PK:'ORDER#'+line.orderId,SK:'META'},ConsistentRead:true,ProjectionExpression:'orderId,orderNumber'}))).Item;printLines.push({orderId:line.orderId,orderNumber:order&&order.orderId===line.orderId&&typeof order.orderNumber==='string'?order.orderNumber:null,...(line.accrual.schemaVersion===5?{sourceKind:line.accrual.kind}:{}),deliveredAt:line.accrual.deliveredAt,amounts:amounts(line.accrual.amounts)});}
   if(!equal(before,await context(v.branchId,'READ')))return fail('PAYOUT_AUTHORIZATION_CHANGED');
   return {branchId:v.branchId,batchId:v.batchId,batchDigest:saved.header.batchDigest,period:saved.header.period,createdAt:saved.header.createdAt,
    approved:!!approval,paymentStatus:claim?.status==='PAID'?'PAID':'UNPAID',payoutId:claim?.payoutId||null,
    summary:{accrualCount:saved.header.summary.accrualCount,amounts:amounts(saved.header.summary.amounts)},
    lines:printLines,
    coverage:'COMPLETE_SAVED_STATEMENT',timeZone:'Asia/Baghdad',generatedAt:new Date(now()).toISOString(),walletMutationPerformed:false};
  },
  async statements(branchId:string,cursor?:string){
   const before=await context(branchId,'READ'),result=await options.listBatches(branchId,cursor),items=[];
   for(const h of result.items||[]){
    const a=await readMerchantStatementApproval(db,branchId,h.batchId,h.batchDigest);
    let claim=await get(key(branchId,'BATCH#'+h.batchId));
    if(claim?.status==='PAID')claim=await readMerchantStatementPayment(db,await options.readBatch(branchId,h.batchId),before.ownerId);
    items.push({...h,approved:!!a,payoutStatus:claim?.status||null,payoutId:claim?.payoutId||null});
   }
   if(!equal(before,await context(branchId,'READ')))return fail('PAYOUT_AUTHORIZATION_CHANGED');
   return {...result,items};
  },
  async details(v:Row){if(!/^MPO:[a-f0-9]{48}$/.test(v.payoutId||'')||Object.keys(v).sort().join(',')!=='branchId,payoutId')return fail('PAYOUT_INVALID_REQUEST');const a=await context(v.branchId,'READ'),r=await get(key(v.branchId,v.payoutId));if(!r||r.ownerId!==a.ownerId)return fail('PAYOUT_UNAVAILABLE');await verifyPaidPayout(r,a.ownerId);const result:Row={payout:publicRow(r),generatedAt:new Date(now()).toISOString(),timeZone:'Asia/Baghdad'};if(!a.owner&&!a.merchantStaff){const personName=async(id:string)=>{if(!id)return null;if(id===r.cashbox?.custodianEmployeeId)return r.cashbox.custodian;const person=await strongGet(db,'staging-PlatformStaff',{pk:'EMPLOYEE#'+id,sk:'PROFILE'});const name=person?.fullName||person?.displayName||person?.name;return typeof name==='string'&&!name.includes('@')?name:null;};const cash=r.cashLedgerJournalId?await verifyCashPayoutPosting(db,r):null,recipientBranch=await strongGet(db,B,{businessId:v.branchId});if(!recipientBranch||recipientBranch.ownerId!==r.ownerId||recipientBranch?.cognitoUserId!==r.ownerId||r.ownerReceiptAt&&r.receiptOwnerId!==r.ownerId)return fail('PAYOUT_PAID_PROOF_INVALID');const recipientIdentity={name:r.receiptActor?.name||r.recipientName||null,role:r.receiptActor?.role||'OWNER',roleLabel:r.receiptActor?.roleLabel||'مالك',businessName:r.receiptActor?.businessName||recipientBranch.businessName||recipientBranch.name||null,identityBasis:r.receiptActor&&r.receiptActor.role!=='OWNER'?'VERIFIED_STAFF_RECEIPT':r.ownerReceiptAt?'VERIFIED_OWNER_RECEIPT':'VERIFIED_OWNER_REQUEST'};result.printIdentity={recipientIdentity,reference:r.method==='CASH'?(r.cashVoucherNumber||cashVoucherNumber(r)):'PSR-'+r.payoutId.slice(4).toUpperCase(),executionRecordedName:await personName(r.executionRecordedBy),reconciledName:await personName(r.reconciledBy),nameBasis:'CUSTODY_SNAPSHOT_OR_CURRENT_STAFF_PROFILE',...(cash?{cashBeforeIqd:cash.balanceBeforeIqd,cashAfterIqd:cash.balanceAfterIqd}:{} )};}if(!a.owner&&!a.merchantStaff&&r.method==='ZAIN_CASH'&&['PROCESSING','AWAITING_RECEIPT','RECEIPT_CONFIRMED','RECONCILIATION_REQUIRED'].includes(r.status)){await context(v.branchId,'STAFF',toWholeIqdExact(readMoney(r.amount)));const privateRow=await get(key(v.branchId,'PRIVATE#'+r.payoutId));if(!privateRow||privateRow.ownerId!==r.ownerId||privateRow.payoutId!==r.payoutId)return fail('PAYOUT_DESTINATION_UNAVAILABLE');result.executionDestination=privateRow.phone;}await context(v.branchId,'READ');return result;},
  async act(v:Row){if(v&&['REQUEST_CASH_OPERATION','POST_CASH_OPERATION','CANCEL_CASH_OPERATION'].includes(v.action))return accounting.act(v);if(v&&['CREATE_CASHBOX','UPDATE_CASHBOX'].includes(v.action))return cashboxAct(v);if(!v||typeof v!=='object'||Array.isArray(v))return fail('PAYOUT_INVALID_REQUEST');if(v.action==='REQUEST_PAYOUT')return request(v);if(['START_PAYOUT_DESTINATION','VERIFY_PAYOUT_DESTINATION'].includes(v.action))return destination(v);return transition(v);}
 };
}
