/** Beneficiary-specific labels only. Existing merchant calls retain byte-compatible defaults. */
export function cashPayoutBeneficiary(p:Record<string,any>) {
  if(p.beneficiaryType === undefined || p.beneficiaryType === 'MERCHANT')
    return {type:'MERCHANT',account:'MERCHANT_DISBURSEMENT_CLEARING',delivery:'MERCHANT_PAYOUT_DELIVERY',returned:'MERCHANT_PAYOUT_RETURN',label:'مطعم'};
  if(p.beneficiaryType !== 'DRIVER' || typeof p.driverId !== 'string' || !p.driverId || p.branchId != null)
    throw Object.assign(Error('PAYOUT_BENEFICIARY_INVALID'),{code:'PAYOUT_BENEFICIARY_INVALID'});
  return {type:'DRIVER',account:'DRIVER_DISBURSEMENT_CLEARING',delivery:'DRIVER_PAYOUT_DELIVERY',returned:'DRIVER_PAYOUT_RETURN',label:'سائق'};
}
