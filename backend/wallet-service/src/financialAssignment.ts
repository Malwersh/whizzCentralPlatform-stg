import { buildDriverOffer, prepareDriverOfferAcceptance } from './driverOffer';
import { prepareDriverOfferFinancialSnapshot } from './driverOfferOrderReader';
import { equal, FinancialRow as Row } from './driverFinancialTransaction';
/** Shared verification of immutable accepted terms. Does not authorize an actor or a state transition. */
export function verifyFinancialAssignment(order:Row,saved:Row|null,subjectId:string) {
 const bad=():never=>{throw Error('FINANCIAL_ASSIGNMENT_CONFLICT');};
 const terms=order.financialAcceptance;
 if(!terms||terms.schemaVersion!==1||terms.paymentMethod!=='COD'||!Number.isSafeInteger(order.assignmentWaveNumber))return bad();
 const offer=buildDriverOffer(saved?.financialOffer?.source);
 if(!saved||saved.responseStatus!=='financial_accepted'||saved.isWinner!==true||!equal(offer,saved.financialOffer)||
   offer.driverId!==order.driverId||offer.driverSubjectId!==subjectId||offer.orderId!==order.orderId||
   saved.waveNumber!==order.assignmentWaveNumber||offer.assignmentVersion!==order.assignmentWaveNumber||
   !equal(terms,saved.acceptedTerms)||terms.offerDigest!==offer.digest||!equal(terms.allocation,offer.allocation)||
   !equal(order.financialSnapshot,prepareDriverOfferFinancialSnapshot(offer.source.order)))return bad();
 const expected=prepareDriverOfferAcceptance({offer,offerId:offer.offerId,driverId:offer.driverId,subjectId,
  assignmentId:offer.assignmentId,assignmentVersion:offer.assignmentVersion,order:offer.source.order,at:terms.acceptedAt,
  policy:{version:offer.policyVersion,enabledRuleVersions:[{id:offer.calculation.rule.id,version:offer.calculation.rule.version,hash:offer.ruleHash}]}});
 if(!equal(expected.acceptedTerms,terms))return bad();
 if(![order.storeId,order.businessId].some(v=>v===offer.branchId)||[order.storeId,order.businessId].some(v=>v!==undefined&&v!==offer.branchId)||order.merchantId!==offer.source.order.merchantId)return bad();
 return offer;
}
