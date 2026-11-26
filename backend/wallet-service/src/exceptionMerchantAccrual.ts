import {prepareFullCashOrderSnapshot,verifyFullCashAssignment} from './fullCashOffer';
import {verifyDeliveryFundedAssignment} from './deliveryFundedOffer';
import {verifyFinancialAssignment} from './financialAssignment';
import {readMoney,moneyFromMinor,toWholeIqdExact} from './money';
import {quoteHash} from './deliveryQuoteRecord';
import {equal} from './driverFinancialTransaction';
import type {MerchantAccrual} from './merchantSettlementAccrual';

type Row=Record<string,any>;
const fail=():never=>{throw Error('EXCEPTION_MERCHANT_ACCRUAL_INVALID');};
/** Separate compensation source. A returned order is NEVER presented as a delivered sale. */
export function deriveExceptionMerchantAccrual(input:{branchId:string;order:Row;acceptedOffer:Row;outcome:Row;payable:Row}):MerchantAccrual{
 const {branchId,order,acceptedOffer,outcome:j,payable:p}=input,orderId=order.orderId;
 const cancellation=j.cancellationCompensation?.schemaVersion===1;
 const custody=cancellation?order.status==='cancelled'&&order.orderStatus==='cancelled'&&j.cancellationCompensation.cancellationOperationId===order.financialOutcome&&['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION'].includes(j.cancellationCompensation.caseKey)&&j.cancellationCompensation.caseId===j.caseId&&order.pickedUpAt==null&&order.pickupAt==null&&order.merchantHandover?.state!=='HANDED_TO_DRIVER'&&(!order.holdId||order.holdStatus==='RELEASED'):order.status==='returned'&&order.orderStatus==='returned'&&!!(order.returnTaskCompletedAt||order.returnStatus==='CONFIRMED'&&order.returnedAt);
 if(!custody||order.storeId!==branchId||order.deletedAt!=null||order.deletionRequestId!=null||order.isDeleted===true||order.cashCollected===true||Number(order.cashCollectedAmount??0)!==0||j.kind!=='ORDER_EXCEPTION_ENTITLEMENTS_JOURNAL'||j.orderId!==orderId||j.branchId!==branchId||j.state!=='POSTED'||j.sk!=='EXCEPTION_ENTITLEMENTS'||order.financialAcceptance&&!j.subjectId)return fail();
 let digest:string,cancelFareCap=0,cancelMerchantCap=0;
 if(cancellation&&!order.financialAcceptance){const snapshot=order.financialSnapshot;if(!snapshot||!equal(snapshot,prepareFullCashOrderSnapshot({order:snapshot.order,deliveryFunding:snapshot.deliveryFunding}))||snapshot.order.orderId!==orderId||snapshot.order.branchId!==branchId)return fail();digest=quoteHash(snapshot);cancelMerchantCap=toWholeIqdExact(snapshot.order.allocation.goodsGross)-toWholeIqdExact(snapshot.order.allocation.merchantGoodsDiscount);}
 else if(order.financialAcceptance.schemaVersion===3){const verified=verifyFullCashAssignment(order,acceptedOffer,j.subjectId);digest=verified.digest;cancelFareCap=toWholeIqdExact(verified.settlement.allocation.driverEarningEntitlement);cancelMerchantCap=toWholeIqdExact(verified.settlement.allocation.merchantGoodsEntitlement);}
 else if(order.financialAcceptance.schemaVersion===2)digest=verifyDeliveryFundedAssignment(order,acceptedOffer,j.subjectId).digest;else digest=verifyFinancialAssignment(order,acceptedOffer,j.subjectId).digest;
 if(cancellation&&(j.driverFareIqd>cancelFareCap||j.merchantCompensationIqd>cancelMerchantCap||j.merchantFundingIqd>j.driverFareIqd||j.cancellationCompensation.driverFareCapIqd!==cancelFareCap||j.cancellationCompensation.merchantCapIqd!==cancelMerchantCap||j.cancellationCompensation.assessment?.foodLossIqd<j.merchantCompensationIqd))return fail();
 const {digest:journalDigest,...body}=j;if(journalDigest!==quoteHash(body)||j.offerDigest!==digest||!equal(j.agreement,order.commercialPricing?.agreement)||j.merchantCompensationIqd<=0||!Number.isSafeInteger(j.merchantCompensationIqd)||!Number.isFinite(Date.parse(j.createdAt)))return fail();
 if(p.kind!=='MERCHANT_EXCEPTION_PAYABLE'||p.financialSchemaVersion!==5||p.orderId!==orderId||p.sk!=='MERCHANT_PAYABLE'||p.walletId!=='WALLET#MERCHANT#'+branchId||p.branchId!==branchId||p.status!=='LOCKED_PENDING_SETTLEMENT'||p.amount!==j.merchantCompensationIqd||p.operationId!==j.operationId||p.journalDigest!==journalDigest||p.createdAt!==j.createdAt||!equal(p.agreement,j.agreement))return fail();
 const F=j.driverFareIqd,M=j.merchantCompensationIqd,B=j.merchantFundingIqd;if(![F,M,B,j.platformFundingIqd].every(x=>Number.isSafeInteger(x)&&x>=0)||j.platformFundingIqd!==F+M-B||!Array.isArray(j.walletLines))return fail();
 const expected=new Map<string,number>([['WALLET#DRIVER#'+order.driverId+'|AVAILABLE',F],['WALLET#MERCHANT#'+branchId+'|AVAILABLE',-B],['WALLET#MERCHANT#'+branchId+'|LOCKED',M]].filter(([,v])=>v!==0) as [string,number][]);
 for(const line of j.walletLines){const key=line.walletId+'|'+line.balanceType;if(!expected.has(key)||expected.get(key)!==line.delta||line.balanceAfter-line.balanceBefore!==line.delta||line.balanceAfter<0)return fail();expected.delete(key);}if(expected.size||j.settlementModel!=='EXCEPTION_ACCRUAL_GL_V1'||j.platformNetIqd!==-F-M+B||j.walletLines.reduce((n:bigint,l:Row)=>n+BigInt(l.delta),0n)+BigInt(j.platformNetIqd)!==0n)return fail();
 const accountingLines=[{account:'DRIVER_FARE_EXPENSE',side:'DEBIT',amount:F},{account:'MERCHANT_COMPENSATION_EXPENSE',side:'DEBIT',amount:M},{account:'MERCHANT_FUNDING_RECOVERY',side:'CREDIT',amount:B},{account:'DRIVER_WALLET_PAYABLE',side:'CREDIT',amount:F},{account:'MERCHANT_WALLET_PAYABLE',side:'CREDIT',amount:M},{account:'MERCHANT_WALLET_PAYABLE',side:'DEBIT',amount:B}].filter(l=>l.amount);if(!equal(j.accountingLines,accountingLines)||j.debit!==F+M+B||j.credit!==j.debit)return fail();
 const amounts=Object.fromEntries(['goodsGross','merchantFundedDiscount','platformFundedDiscount','merchantGoodsEntitlement','merchantCommission','merchantOtherCharges','customerGoodsPayment','customerServiceFee','customerDeliveryFee','driverEarning','driverTip','platformOtherCharges','customerTotal','platformNetContribution'].map(k=>[k,moneyFromMinor(0)]));
 amounts.merchantNet=moneyFromMinor(j.merchantCompensationIqd*1000);amounts.merchantExceptionCompensation=amounts.merchantNet;
 for(const m of Object.values(amounts))toWholeIqdExact(readMoney(m));
 const content={schemaVersion:5,kind:'MERCHANT_EXCEPTION_ACCRUAL',accrualId:'MACC:'+quoteHash({branchId,orderId,operationId:j.operationId}).slice(0,48),branchId,orderId,operationId:j.operationId,deliveredAt:j.createdAt,accruedAt:j.createdAt,currency:'IQD',status:'LOCKED_PENDING_SETTLEMENT',agreement:j.agreement,amounts,sourceDigests:{outcome:quoteHash(j),payable:quoteHash(p),acceptedOffer:digest},payoutAuthorized:false,walletMutationPerformed:false};
 return {...content,digest:quoteHash(content)};
}
