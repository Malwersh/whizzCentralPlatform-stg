import {verifyFullCashOffer,fullCashOfferView,prepareFullCashOfferAcceptance} from './fullCashOffer';
import { buildDriverOffer, driverOfferView, prepareDriverOfferAcceptance, DriverOfferError } from './driverOffer';
import { buildDeliveryFundedOffer, deliveryFundedOfferView, prepareDeliveryFundedOfferAcceptance } from './deliveryFundedOffer';
import { equal } from './driverFinancialTransaction';
type Row=Record<string,any>;
/** Internal normalization only. Persist versionedOffer, never this adapter row.
 * Explicit capability required at every server boundary; no client version opt-in.
 */
export function resolveFinancialOffer(value:Row,enableDeliveryFunding=false,enableFullCash=false):Row {
 if(value?.schemaVersion===3){
  if(!enableFullCash)throw Error('FULL_CASH_OFFER_DISABLED');
  const rebuilt=verifyFullCashOffer(value);
  return {...rebuilt.baseOffer,digest:rebuilt.digest,snapshotHash:rebuilt.financialSnapshot.digest,allocation:rebuilt.settlement.allocation,versionedOffer:rebuilt};
 }
 if(value?.schemaVersion===2){
  if(!enableDeliveryFunding)throw Error('DELIVERY_FUNDED_OFFER_DISABLED');
  const rebuilt=buildDeliveryFundedOffer({schemaVersion:2,base:value.baseOffer?.source,deliveryFunding:value.financialSnapshot?.deliveryFunding});
  if(!equal(rebuilt,value))throw Error('FINANCIAL_OFFER_CHANGED');
  return {...rebuilt.baseOffer,digest:rebuilt.digest,snapshotHash:rebuilt.financialSnapshot.digest,allocation:rebuilt.allocation,versionedOffer:rebuilt};
 }
 const rebuilt=buildDriverOffer(value?.source);if(!equal(rebuilt,value))throw new DriverOfferError('INVALID_DRIVER_OFFER');return {...rebuilt,versionedOffer:rebuilt};
}
export function versionedFinancialOfferView(value:Row,driverId:string,subjectId:string,at:string,enabled=false,fullCash=false){
 const offer=resolveFinancialOffer(value.versionedOffer??value,enabled,fullCash),raw=offer.versionedOffer;
 if(raw.schemaVersion===3)return fullCashOfferView(raw,driverId,subjectId,at);
 return raw.schemaVersion===2?deliveryFundedOfferView(raw,driverId,subjectId,at):driverOfferView(raw,driverId,subjectId,at);
}
export function versionedFinancialOfferAcceptance(input:Row,enabled=false,fullCash=false){
 const offer=resolveFinancialOffer(input.offer.versionedOffer??input.offer,enabled,fullCash),raw=offer.versionedOffer;
 if(raw.schemaVersion===3)return prepareFullCashOfferAcceptance({...input,deliveryFunding:input.deliveryFunding??null,offer:raw});
 if(raw.schemaVersion===2)return prepareDeliveryFundedOfferAcceptance({...input,offer:raw});
 const {deliveryFunding:_funding,...legacy}=input;return prepareDriverOfferAcceptance({...legacy,offer:raw});
}
