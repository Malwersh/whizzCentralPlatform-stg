import {quoteHash} from './deliveryQuoteRecord';
import {moneyFromMinor} from './money';
type Row=Record<string,any>;
export const CASH_ADJUDICATION_OUTCOMES=['CUSTOMER_RECEIVABLE','COMPANY_COVERAGE','DRIVER_RESPONSIBILITY','MERCHANT_ADJUSTMENT','NO_SHORTFALL'] as const;
const fail=(code='CASH_ADJUDICATION_INVALID'):never=>{throw Object.assign(Error(code),{code});};
export function cashReportsDigest(row:Row){return quoteHash({reports:row.reports??[],contacts:row.contactAttempts??[]});}
/** Administrative finding, never a substituted customer/driver declaration. */
export function prepareCashAdjudication(row:Row,order:Row,input:Row,actorId:string,at:string){
 const expected=order.financialAcceptance?.allocation?.customerTotal;
 if(expected?.currency!=='IQD'||expected.scale!==1000||!Number.isSafeInteger(expected.minorAmount)||expected.minorAmount%1000)return fail();
 const expectedIqd=expected.minorAmount/1000,paid=input.collectedIqd;
 if(!Number.isSafeInteger(paid)||paid<0||paid>expectedIqd||!CASH_ADJUDICATION_OUTCOMES.includes(input.outcome)||
  !['MISSING_DECLARATION','DISPUTED_AMOUNT','MATCHED_SHORTFALL'].includes(input.reviewBasis)||input.confirmDelivered!==true||
  !Array.isArray(input.evidenceReferences)||input.evidenceReferences.length<1||input.evidenceReferences.length>10||
  !input.evidenceReferences.every((s:any)=>typeof s==='string'&&s.trim().length>=5&&s.length<=1000))return fail();
 const latest=(kind:string)=>[...(row.reports??[])].reverse().find(r=>r.actorKind===kind);
 const customer=latest('CUSTOMER'),driver=latest('DRIVER');
 if(input.reviewBasis==='MISSING_DECLARATION'?(!!customer&&!!driver):input.reviewBasis==='DISPUTED_AMOUNT'?(!customer||!driver||customer.reportedPaidIqd===driver.reportedPaidIqd):
  (!customer||!driver||customer.reportedPaidIqd!==paid||driver.reportedPaidIqd!==paid||paid>=expectedIqd||row.collectionVerification?.customerReportId!==customer.reportId||row.collectionVerification?.driverReportId!==driver.reportId))return fail('CASH_ADJUDICATION_BASIS_CHANGED');
 // Document an attempt to clarify with both parties; these are staff observations,
 // not declarations. A refusal/unreachable outcome does not establish an amount.
 for(const party of ['CUSTOMER','DRIVER'])if(!(row.contactAttempts??[]).some((r:Row)=>r.party===party))return fail('CASH_CONTACT_REQUIRED');
 const shortfallIqd=expectedIqd-paid;
 if((shortfallIqd===0)!==(input.outcome==='NO_SHORTFALL'))return fail();
 if(input.outcome==='MERCHANT_ADJUSTMENT'&&shortfallIqd>order.financialAcceptance.allocation.merchantPayable.minorAmount/1000)return fail('CASH_ADJUSTMENT_EXCEEDS_PAYABLE');
 const content={schemaVersion:1,decisionId:input.idempotencyKey,caseId:row.caseId,orderId:order.orderId,
  basis:input.reviewBasis,outcome:input.outcome,expectedIqd,collectedIqd:paid,shortfallIqd,
  confirmDelivered:true,evidenceReferences:input.evidenceReferences.map((s:string)=>s.trim()),
  reason:input.reason.trim(),approvedBy:actorId,approvedAt:at,reportsDigest:cashReportsDigest(row),
  acceptedTermsDigest:quoteHash(order.financialAcceptance),status:'APPROVED',physicalCashDeclaration:false};
 return {...content,digest:quoteHash(content)};
}
/** Separate balanced correction to the original, preserved quote economics.
 * No cashbox/payout is fabricated. Driver responsibility is already borne through
 * collateral capture, so it must never debit that driver a second time. */
export function cashAdjudicationAdjustment(decision:Row){
 const {digest,status,execution,...saved}=decision;
 const original={...saved,status:'APPROVED'};
 if(quoteHash(original)!==digest||!['APPROVED','EXECUTED'].includes(status))return fail('CASH_ADJUDICATION_CHANGED');
 return cashAdjudicationEffects(decision.outcome,decision.shortfallIqd);
}
export function cashAdjudicationEffects(outcome:string,shortfallIqd:number){
 if(!CASH_ADJUDICATION_OUTCOMES.includes(outcome as any)||!Number.isSafeInteger(shortfallIqd)||shortfallIqd<0||shortfallIqd>Math.floor(Number.MAX_SAFE_INTEGER/1000))return fail();
 const amount=shortfallIqd;
 const driverCreditIqd=['CUSTOMER_RECEIVABLE','COMPANY_COVERAGE','MERCHANT_ADJUSTMENT'].includes(outcome)?amount:0;
 const merchantReductionIqd=outcome==='MERCHANT_ADJUSTMENT'?amount:0;
 const lines:Row[]=driverCreditIqd?[{account:outcome==='CUSTOMER_RECEIVABLE'?'CUSTOMER_CASH_RECEIVABLE':merchantReductionIqd?'MERCHANT_PAYABLE':'CASH_SHORTFALL_EXPENSE',side:'DEBIT',amount:moneyFromMinor(driverCreditIqd*1000)},
  {account:'DRIVER_WALLET_PAYABLE',side:'CREDIT',amount:moneyFromMinor(driverCreditIqd*1000)}]:[];
 return {driverCreditIqd,merchantReductionIqd,receivableIqd:outcome==='CUSTOMER_RECEIVABLE'?amount:0,
  companyExpenseIqd:outcome==='COMPANY_COVERAGE'?amount:0,
  driverResponsibilityIqd:outcome==='DRIVER_RESPONSIBILITY'?amount:0,lines,
  additionalDriverDebitIqd:0,physicalCashMovement:false};
}
