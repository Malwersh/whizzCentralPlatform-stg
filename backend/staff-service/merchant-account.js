'use strict';
// Branch-indexed financial movements. No scans, balance writes, or price recalculation.
const {QueryCommand,GetCommand}=require('@aws-sdk/lib-dynamodb');
const fields=require('./settlement-evidence-fields.json');
const fail=code=>{throw Object.assign(Error(code),{code});};
const valid=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v);
const labels={merchantAdministrativeAdjustment:'تصحيح إداري معتمد على مستحق المطعم',customerCashCollected:'المبلغ المحصل المثبت إداريًا',customerCashShortfall:'فرق النقد المعالج بقرار مستقل',merchantExceptionCompensation:'تعويض معتمد عن طلب مرتجع أو متعذر',goodsGross:'قيمة المنتجات قبل الخصم',merchantFundedDiscount:'خصم يموله المطعم',platformFundedDiscount:'خصم تموله المنصة',merchantGoodsEntitlement:'حق المنتجات بعد خصم المطعم',merchantCommission:'عمولة المنصة من المطعم',merchantOtherCharges:'رسوم أخرى على المطعم',merchantDeliverySupport:'دعم التوصيل على المطعم',merchantNet:'صافي مستحق المطعم',customerGoodsPayment:'قيمة المنتجات على الزبون',customerServiceFee:'رسوم الخدمة على الزبون',customerDeliveryFee:'رسوم التوصيل على الزبون',customerTotal:'إجمالي فاتورة الزبون',driverEarning:'أجرة السائق الأساسية',driverTip:'إكرامية السائق — ليست دخلًا للمطعم',driverTotalEntitlement:'إجمالي استحقاق السائق',driverCashRetained:'النقد المحتفظ به لدى السائق',driverWalletCreditTotal:'المضاف لمحفظة السائق',driverWalletHold:'حجز السائق المسوّى',platformNetContribution:'صافي مساهمة الطلب للمنصة',platformOtherCharges:'رسوم المنصة الأخرى',platformDeliveryPromotionFunding:'دعم عرض التوصيل من المنصة',referenceDeliveryFee:'رسم التوصيل المرجعي',deliveryPromotionSubsidy:'إجمالي دعم عرض التوصيل',baselineDeliveryMargin:'هامش التوصيل قبل العرض',deliveryNetContribution:'صافي مساهمة التوصيل'};
const merchantFields=['merchantAdministrativeAdjustment','customerCashCollected','customerCashShortfall','merchantExceptionCompensation','goodsGross','merchantFundedDiscount','platformFundedDiscount','merchantGoodsEntitlement','merchantCommission','merchantOtherCharges','merchantDeliverySupport','merchantNet','customerGoodsPayment','customerServiceFee','customerDeliveryFee','customerTotal','driverTip','platformDeliveryPromotionFunding'];
function bounds(v){
 if(!v||Object.keys(v).some(k=>!['branchId','fromLocalDate','throughLocalDate','cursor'].includes(k))||!valid(v.branchId))fail('PAYOUT_ACCOUNT_INVALID_FILTER');
 const date=x=>{if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))fail('PAYOUT_ACCOUNT_INVALID_FILTER');const n=Date.parse(x+'T00:00:00.000Z');if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==x)fail('PAYOUT_ACCOUNT_INVALID_FILTER');return n;};
 const from=date(v.fromLocalDate),through=date(v.throughLocalDate);if(from>through||through-from>365*86400000)fail('PAYOUT_ACCOUNT_INVALID_FILTER');
 return {from:new Date(from-10800000).toISOString(),until:new Date(through+86400000-10800000).toISOString()};
}
async function readLedger(db,v,owner,skipLedger=false){
 const range=bounds(v),walletId='WALLET#MERCHANT#'+v.branchId;
 const evidence=require('./settlement-orders').projectEvidenceDb(db),get=async(table,key)=>(await evidence.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 const wallet=await get('staging-Wallets',{walletId,sk:'META'});
 if(wallet&&(wallet.ownerId!==v.branchId||wallet.ownerType!=='MERCHANT'||wallet.currency!=='IQD'||!Number.isSafeInteger(wallet.version)||!Number.isSafeInteger(wallet.lockedBalance)||wallet.lockedBalance<0))fail('PAYOUT_ACCOUNT_WALLET_INVALID');
 const version=wallet?.version??null;let cursor;
 if(v.cursor){try{if(typeof v.cursor!=='string'||v.cursor.length>4000)throw Error();const c=JSON.parse(Buffer.from(v.cursor,'base64url').toString());if(c.branchId!==v.branchId||c.from!==v.fromLocalDate||c.through!==v.throughLocalDate||c.key?.walletId!==walletId||typeof c.key?.sk!=='string'||!c.key.sk.startsWith('ts#')||Object.keys(c.key).sort().join(',')!=='sk,walletId')throw Error();if(c.version!==version)fail('PAYOUT_ACCOUNT_CHANGED');cursor=c.key;}catch(e){if(e.code)throw e;fail('PAYOUT_ACCOUNT_INVALID_CURSOR');}}
 const names=Object.fromEntries(fields['staging-LedgerEntries'].map((key,i)=>['#a'+i,key]));
 const q=skipLedger?{Items:[]}:await db.send(new QueryCommand({TableName:'staging-LedgerEntries',ConsistentRead:true,Select:'SPECIFIC_ATTRIBUTES',ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:names,KeyConditionExpression:'walletId=:wallet AND sk BETWEEN :from AND :until',ExpressionAttributeValues:{':wallet':walletId,':from':'ts#'+range.from,':until':'ts#'+range.until},ScanIndexForward:false,Limit:20,...(cursor?{ExclusiveStartKey:cursor}:{})}));
 const {readMerchantAccrualEvidence,verifyMerchantPayoutJournal}=require('./settlement-runtime'),items=[];
 for(const row of q.Items||[]){
  const occurredAt=/^ts#([^#]+)#/.exec(row.sk||'')?.[1];
  const base={entryId:row.sk,operationId:row.transactionId,occurredAt:occurredAt||null};
  try{
   if(['COD_COMPLETED','FULL_CASH_COMPLETED','CASH_ADJUDICATION_SETTLED','ORDER_EXCEPTION_FINANCIAL'].includes(row.category)&&row.metadata?.balanceType==='LOCKED'){
    if(!valid(row.relatedEntityId)||row.metadata?.orderId!==row.relatedEntityId)throw Error();
    const proof=await readMerchantAccrualEvidence(evidence,v.branchId,row.relatedEntityId),a=proof.accrual;
    if(row.transactionId!==a.operationId||row.amount*1000!==a.amounts.merchantNet.minorAmount||occurredAt!==a.deliveredAt)throw Error();
    let state=proof.payable.status==='PAID'?'PAID':'PENDING_SETTLEMENT',payoutId=proof.payable.paidPayoutId||null;
    if(state!=='PAID'&&proof.payable.settlementBatchId){const claim=await get('staging-MerchantPlatform',{pk:'MERCHANT_PAYOUT#'+v.branchId,sk:'BATCH#'+proof.payable.settlementBatchId});state=claim?.status==='ACTIVE'?'IN_PAYOUT':'IN_STATEMENT';payoutId=claim?.payoutId||null;}
    const amounts=owner?Object.fromEntries(merchantFields.filter(k=>a.amounts[k]!==undefined).map(k=>[k,a.amounts[k]])):{...a.amounts,...Object.fromEntries(['driverTotalEntitlement','driverCashRetained','driverWalletCreditTotal','driverWalletHold'].filter(k=>proof.outcome.allocation?.[k]!==undefined).map(k=>[k,proof.outcome.allocation?.[k]]))};
    items.push({...base,kind:a.schemaVersion===5?'EXCEPTION_COMPENSATION':'ORDER_ACCRUAL',occurredAt:a.deliveredAt,orderId:proof.order.orderId,orderNumber:proof.order.orderNumber||proof.order.orderId,amounts,state,statementId:proof.payable.settlementBatchId||null,payoutId,paidAt:proof.payable.paidAt||null,evidenceVerified:true});
   }else if(row.category==='ORDER_EXCEPTION_FINANCIAL'&&row.metadata?.balanceType==='AVAILABLE'){
    const j=await get('staging-Holds',{orderId:row.relatedEntityId,sk:'EXCEPTION_ENTITLEMENTS'}),{digest,...rest}=j||{};
    if(!j||j.kind!=='ORDER_EXCEPTION_ENTITLEMENTS_JOURNAL'||j.state!=='POSTED'||j.branchId!==v.branchId||require('./merchant-account-index-runtime').quoteHash(rest)!==digest||row.transactionId!==j.operationId||row.amount!==-j.merchantFundingIqd||row.amount>=0)throw Error();
    items.push({...base,kind:'EXCEPTION_FUNDING',state:'POSTED',amountIqd:row.amount,orderId:row.relatedEntityId,evidenceVerified:true});
   }else if(row.category==='MERCHANT_PAYOUT_PAID'&&row.metadata?.balanceType==='LOCKED'){
    const id=row.relatedEntityId;if(typeof id!=='string'||!/^MPO:[a-f0-9]{48}$/.test(id))throw Error();
    const journal=await get('staging-MerchantPlatform',{pk:'MERCHANT_PAYOUT_PAID#'+id,sk:'META'});
    if(!journal||row.transactionId!==id||row.metadata?.journalDigest!==journal.digest||row.amount*1000!==-(journal.baseAmount??journal.amount)?.minorAmount||occurredAt!==journal.paidAt||!journal.orderLines?.length||journal.orderLines.length>10)throw Error();
    for(const line of journal.orderLines){const payable=await get('staging-Holds',{orderId:line.orderId,sk:'MERCHANT_PAYABLE'});if(!payable||payable.status!=='PAID'||payable.paidPayoutId!==id)throw Error();verifyMerchantPayoutJournal(journal,v.branchId,payable);}
    items.push({...base,kind:'PAYOUT',state:'PAID',amount:journal.amount,...(journal.correctionSettlement?{settledLiabilityAmount:journal.baseAmount,correctionSettlement:journal.correctionSettlement,settlementMode:journal.settlementMode}:{}),occurredAt:journal.paidAt,payoutId:id,statementId:journal.batchId,method:journal.method,externalReference:journal.externalReference,executionFeeIqd:journal.executionFee,feeChargedTo:'PLATFORM',...(!owner?{sourceAccount:journal.sourceAccount}:{}),evidenceVerified:true});
   }else items.push({...base,kind:'REVIEW_REQUIRED',state:'REVIEW_REQUIRED',evidenceVerified:false,reason:'UNSUPPORTED_LEDGER_MOVEMENT'});
  }catch(e){if(['AccessDeniedException','ThrottlingException','ProvisionedThroughputExceededException'].includes(e.name))throw e;items.push({...base,kind:'REVIEW_REQUIRED',state:'REVIEW_REQUIRED',evidenceVerified:false,reason:'FINANCIAL_EVIDENCE_REVIEW_REQUIRED'});}
 }
 const after=await get('staging-Wallets',{walletId,sk:'META'});if((after?.version??null)!==version||after?.lockedBalance!==wallet?.lockedBalance)fail('PAYOUT_ACCOUNT_CHANGED');
 const nextCursor=q.LastEvaluatedKey?Buffer.from(JSON.stringify({branchId:v.branchId,from:v.fromLocalDate,through:v.throughLocalDate,version,key:q.LastEvaluatedKey})).toString('base64url'):null;
 return {items,nextCursor,amountLabels:Object.fromEntries(Object.entries(labels).filter(([k])=>!owner||merchantFields.includes(k))),fromLocalDate:v.fromLocalDate,throughLocalDate:v.throughLocalDate,timeZone:'Asia/Baghdad',dateBasis:items.some(r=>r.kind==='EXCEPTION_COMPENSATION')?'DELIVERY_FOR_SALES_ACCRUAL_FOR_COMPENSATION_PAID_AT_FOR_PAYOUT':'DELIVERY_FOR_ACCRUAL_AND_PAID_AT_FOR_PAYOUT',coverage:'POSTED_MERCHANT_LEDGER_MOVEMENTS',pageOnly:true,wallet:wallet?{pendingIqd:wallet.lockedBalance,version}:null,generatedAt:new Date().toISOString(),walletMutationPerformed:false};
}
// Supplement posted movements with verified zero-net completions, which correctly
// have no wallet credit. Do not fabricate ledger entries or duplicate positive net.
async function read(db,v,owner){
 const range=bounds(v),runtime=require('./merchant-account-index-runtime');
 const projected=require('./settlement-orders').projectEvidenceDb(db);
 const get=async(table,key)=>(await (table==='staging-Wallets'?projected:db).send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 const coverage=await get('staging-MerchantPlatform',{pk:'SYSTEM#MERCHANT_ACCRUAL_INDEX',sk:'COVERAGE'});
 const {digest,...body}=coverage||{};
 if(!coverage||coverage.kind!=='MERCHANT_ACCRUAL_INDEX_COVERAGE'||coverage.schemaVersion!==1||coverage.status!=='COMPLETE'||runtime.quoteHash(body)!==digest)fail('PAYOUT_ACCOUNT_INDEX_NOT_READY');
 const pins=await runtime.readMerchantAccrualRange(db,v.branchId,range.from,range.until);
 const walletId='WALLET#MERCHANT#'+v.branchId;
 const wallet=await get('staging-Wallets',{walletId,sk:'META'});
 const revision=runtime.quoteHash({pins,coverage:coverage.digest,version:wallet?.version??null,pendingIqd:wallet?.lockedBalance??null});
 let c={phase:'LEDGER'};
 if(v.cursor){try{
  if(typeof v.cursor!=='string'||v.cursor.length>4000)throw Error();
  c=JSON.parse(Buffer.from(v.cursor,'base64url').toString());
  if(Object.keys(c).sort().join(',')!=='branchId,from,key,phase,revision,through,v'||c.v!==2||c.branchId!==v.branchId||c.from!==v.fromLocalDate||c.through!==v.throughLocalDate||!['LEDGER','ZERO_NET'].includes(c.phase))throw Error();
  if(c.revision!==revision)fail('PAYOUT_ACCOUNT_CHANGED');
 }catch(e){if(e.code)throw e;fail('PAYOUT_ACCOUNT_INVALID_CURSOR');}}
 const {cursor:_cursor,...filter}=v;
 // Read-only legacy path also verifies wallet ownership and each payout journal.
 const ledger=c.phase==='LEDGER'?await readLedger(db,{...filter,...(c.key?{cursor:c.key}:{})},owner):await readLedger(db,filter,owner,true);
 let phase='LEDGER',key=ledger.nextCursor;
 if(c.phase==='ZERO_NET'||!key){
  phase='ZERO_NET';
  const page=await runtime.readMerchantAccrualIndexPage(db,{branchId:v.branchId,fromUtc:range.from,untilExclusiveUtc:range.until,...(c.phase==='ZERO_NET'&&c.key?{key:c.key}:{})});
  const evidence=require('./settlement-orders').projectEvidenceDb(db);
  for(const row of page.items){
   if(row.merchantNetIqd!==0)continue;
   const base={entryId:'ZERO_NET#'+row.orderId,operationId:row.operationId,occurredAt:row.deliveredAt,orderId:row.orderId};
   try{
    const proof=await require('./settlement-runtime').readMerchantAccrualEvidence(evidence,v.branchId,row.orderId),a=proof.accrual;
    if(a.amounts.merchantNet.minorAmount!==0||a.deliveredAt!==row.deliveredAt||a.operationId!==row.operationId||proof.payable.status==='PAID')throw Error();
    const amounts=owner?Object.fromEntries(merchantFields.filter(k=>a.amounts[k]!==undefined).map(k=>[k,a.amounts[k]])):{...a.amounts,...Object.fromEntries(['driverTotalEntitlement','driverCashRetained','driverWalletCreditTotal','driverWalletHold'].filter(k=>proof.outcome.allocation?.[k]!==undefined).map(k=>[k,proof.outcome.allocation?.[k]]))};
    ledger.items.push({...base,kind:'ORDER_ACCRUAL',orderNumber:proof.order.orderNumber||row.orderId,amounts,state:'NO_PAYOUT_REQUIRED',statementId:proof.payable.settlementBatchId||null,payoutId:null,paidAt:null,evidenceVerified:true});
   }catch(e){if(['AccessDeniedException','ThrottlingException','ProvisionedThroughputExceededException'].includes(e.name))throw e;ledger.items.push({...base,kind:'REVIEW_REQUIRED',state:'REVIEW_REQUIRED',evidenceVerified:false,reason:'FINANCIAL_EVIDENCE_REVIEW_REQUIRED'});}
  }
  key=page.nextKey;
 }
 const after=await get('staging-Wallets',{walletId,sk:'META'});
 if((after?.version??null)!==(wallet?.version??null)||after?.lockedBalance!==wallet?.lockedBalance||runtime.quoteHash(await runtime.readMerchantAccrualRange(db,v.branchId,range.from,range.until))!==runtime.quoteHash(pins)||(await get('staging-MerchantPlatform',{pk:coverage.pk,sk:coverage.sk}))?.digest!==coverage.digest)fail('PAYOUT_ACCOUNT_CHANGED');
 return {...ledger,nextCursor:key?Buffer.from(JSON.stringify({v:2,branchId:v.branchId,from:v.fromLocalDate,through:v.throughLocalDate,revision,phase,key})).toString('base64url'):null,sourceRevision:revision,additionalCoverage:'INDEXED_ZERO_NET_COMPLETIONS',generatedAt:new Date().toISOString()};
}
module.exports={read,bounds};
