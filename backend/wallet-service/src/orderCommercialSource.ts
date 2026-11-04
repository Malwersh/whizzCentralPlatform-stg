import {calculateCashRounding, CASH_ROUNDING_PK} from './cashRounding';
import {prepareFullCashOrderSnapshot} from './fullCashOffer';
import {prepareGoodsPromotionExposure} from './goodsPromotionExposure';
import {assertMinimumOrder} from './branchMinimumOrder';
import {DynamoDBDocumentClient, GetCommand} from '@aws-sdk/lib-dynamodb';
import {prepareDeliveryFundedFinancialSnapshot} from './deliveryFundedOffer';
import {allocateDeliveryFundedOrder} from './deliveryFundedAllocation';
import {preparePlatformPromotionFunding} from './platformPromotionFunding';
import {calculateOrderCommercialPricing} from './orderCommercialPricing';
import {createStagingOrderGoodsPricing} from './orderGoodsPricing';
import {moneyFromMinor, readMoney, multiplyMoney, readWholeIqdRounding, quantizeWholeIqd, toWholeIqdExact} from './money';
import {quoteEntityIdValid, quoteHash} from './deliveryQuoteRecord';
import {prepareDriverOfferFinancialSnapshot} from './driverOfferOrderReader';
type Row=Record<string,any>;
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const platform='staging-MerchantPlatform', staff='staging-PlatformStaff';
export class CommercialSourceError extends Error {
 readonly statusCode=409;
 constructor(public readonly code:string){super(code);this.name='CommercialSourceError';}
}
const fail=(code='COMMERCIAL_SOURCE_UNAVAILABLE'):never=>{throw new CommercialSourceError(code);};
function validId(v:unknown):string {if(!quoteEntityIdValid(v))return fail();return v;}
function positive(v:unknown):number {if(!Number.isSafeInteger(v)||Number(v)<1)return fail();return v as number;}
function instant(v:unknown):number {if(typeof v!=='string'||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)return fail();return Date.parse(v);}
function exact(v:unknown,keys:string[]):Row {if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))return fail();return v as Row;}
function pin(table:string,key:Row,row:Row,fields=Object.keys(row)) {
 const names:Row={},values:Row={},clauses:string[]=[];
 fields.forEach((f,i)=>{names['#p'+i]=f;if(row[f]===undefined)clauses.push(`attribute_not_exists(#p${i})`);
 else {values[':p'+i]=copy(row[f]);clauses.push(`#p${i}=:p${i}`);}});
 if(Buffer.byteLength(clauses.join(' AND '))>3900)return fail();
 return {ConditionCheck:{TableName:table,Key:key,ConditionExpression:clauses.join(' AND '),ExpressionAttributeNames:names,ExpressionAttributeValues:values}};
}
/** Staging-only trusted source composition. Reads server-owned, separately accepted/approved records.
 * No initialization, assumed rates, client-supplied agreement/funding or standalone wallet write.
 * Operations MUST commit together with the order, catalog, campaign usage and Quote fences. */
export async function readStagingCommercialAgreement(db:Pick<DynamoDBDocumentClient,'send'>,branchId:string,at:number){
 validId(branchId);
 async function get(table:string,key:Row):Promise<Row>{try{const r=await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}));if(!r.Item)return fail();return copy(r.Item);}catch(e){if(e instanceof CommercialSourceError)throw e;return fail();}}
  const branch=await get('WhizzMerchants_Businesses',{businessId:branchId});
  const merchantId=validId(branch.organizationId),ownerId=validId(branch.ownerId);
  if(branch.businessId!==branchId||branch.cognitoUserId!==ownerId||branch.isActive!==true||branch.status!=='approved'||
   branch.deletionRequestId!=null||branch.platformSuspended===true||branch.ordersBlocked===true||
   (branch.onboardingSchemaVersion!==undefined&&(branch.onboardingComplete!==true||branch.acceptingOrders!==true)))return fail();
  const orgKey={pk:'PERSON#'+ownerId,sk:'ORGANIZATION#'+merchantId};
  const org=await get(platform,orgKey);if(org.organizationId!==merchantId||org.subjectId!==ownerId||org.deletionRequestId!=null)return fail();
  // No name/phone/default agreement lookup: a branch's explicit reference selects one immutable version.
  const agreementId=validId(branch.commercialAgreementId),version=positive(branch.commercialAgreementVersion);
  const key={pk:'COMMERCIAL_AGREEMENT#'+agreementId,sk:'VERSION#'+version};
  const record=await get(platform,key);
  exact(record,['pk','sk','schemaVersion','terms','otherCharges','allowedFundingPolicyIds','termsHash',...(record.schemaVersion===2?['fundingPolicySnapshots']:[])]);
  if(record.pk!==key.pk||record.sk!==key.sk||![1,2].includes(record.schemaVersion)||!Array.isArray(record.allowedFundingPolicyIds)||
   record.allowedFundingPolicyIds.length>20||new Set(record.allowedFundingPolicyIds).size!==record.allowedFundingPolicyIds.length||
   record.allowedFundingPolicyIds.some((v:any)=>!quoteEntityIdValid(v)))return fail();
  if(record.schemaVersion===2){
   if(!Array.isArray(record.fundingPolicySnapshots)||record.fundingPolicySnapshots.length!==record.allowedFundingPolicyIds.length)return fail();
   const seen=new Set<string>();
   for(const v of record.fundingPolicySnapshots){exact(v,['id','version','digest']);validId(v.id);positive(v.version);if(seen.has(v.id)||!record.allowedFundingPolicyIds.includes(v.id)||typeof v.digest!=='string'||!/^[a-f0-9]{64}$/.test(v.digest))return fail();seen.add(v.id);}
  }
  if(record.termsHash!==quoteHash({terms:record.terms,otherCharges:record.otherCharges,allowedFundingPolicyIds:record.allowedFundingPolicyIds,...(record.schemaVersion===2?{fundingPolicySnapshots:record.fundingPolicySnapshots}:{})}))return fail();
  let terms=copy(record.terms);
  if(terms.id!==agreementId||terms.version!==version||terms.merchantId!==merchantId||
   (terms.branchId!==null&&terms.branchId!==branchId)||terms.status!=='ACTIVE'||at<instant(terms.effectiveFrom)||
   (terms.effectiveTo!==null&&at>=instant(terms.effectiveTo)))return fail();
  const currentKey={pk:key.pk,sk:'CURRENT'},current=await get(platform,currentKey);
  exact(current,['pk','sk','version','termsHash','status']);
  if(current.version!==version||current.termsHash!==record.termsHash||current.status!=='ACTIVE')return fail();
  const acceptanceKey={pk:key.pk,sk:'ACCEPTANCE#'+version},approvalKey={pk:key.pk,sk:'APPROVAL#'+version};
  const acceptance=await get(platform,acceptanceKey),approval=await get(staff,approvalKey);
  exact(acceptance,['pk','sk','subjectId','termsHash','acceptedAt','status']);
  exact(approval,['pk','sk','staffId','termsHash','approvedAt','status']);
  if(acceptance.subjectId!==ownerId||acceptance.termsHash!==record.termsHash||acceptance.status!=='ACCEPTED'||
   approval.termsHash!==record.termsHash||approval.status!=='APPROVED'||!quoteEntityIdValid(approval.staffId)||
   acceptance.acceptedAt!==terms.acceptedAt||approval.approvedAt!==terms.approvedAt||
   instant(acceptance.acceptedAt)>at||instant(approval.approvedAt)>at)return fail();
 return {branch,merchantId,ownerId,orgKey,org,agreementId,version,key,record,terms,currentKey,current,acceptanceKey,approvalKey,acceptance,approval};
}
export function createStagingCommercialSource(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;enableFullCash?:boolean;cashRoundingRequired?:boolean;deliveryPromotion?:{prepare:(facts:any)=>Promise<Row>}}) {
 const {db}=options,now=options.now??Date.now;
 async function get(table:string,key:Row):Promise<Row>{try{const r=await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}));if(!r.Item)return fail();return copy(r.Item);}catch(e){if(e instanceof CommercialSourceError)throw e;return fail();}}
 return Object.freeze({async prepare(input:unknown) {
  const r=copy(exact(input,['orderId','branchId','items','quote','discount','tip']));
  const orderId=validId(r.orderId),branchId=validId(r.branchId),at=now(),timestamp=new Date(at).toISOString();
  // Pricing instant is immutable across preview/confirmation; live validity is checked again below.
  const quote=exact(r.quote,['createdAt','expiresAt','deliveryFeeMinor','origin','destination','destinationRegionId']);
  if(at<instant(quote.createdAt)||at>=instant(quote.expiresAt)||instant(quote.expiresAt)-instant(quote.createdAt)>120000)return fail('COMMERCIAL_QUOTE_EXPIRED');
  if(!Number.isSafeInteger(quote.deliveryFeeMinor)||quote.deliveryFeeMinor<0)return fail();
  const tip=readMoney(r.tip);if(tip.minorAmount<0)return fail();
  let {branch,merchantId,ownerId,orgKey,org,agreementId,version,key,record,terms,currentKey,current,acceptanceKey,approvalKey,acceptance,approval}=await readStagingCommercialAgreement(db,branchId,at);
  const goods=await createStagingOrderGoodsPricing({db}).price({branchId,items:r.items});

  const operations:Row[]=[...goods.conditions,pin(platform,orgKey,org),pin(platform,key,record),pin(platform,currentKey,current),
   pin(platform,acceptanceKey,acceptance),pin(staff,approvalKey,approval)];
  const discounts:Row[]=[];let fundingPolicy:Row|null=null;
  let validUntil=Math.min(instant(quote.expiresAt),terms.effectiveTo===null?Infinity:instant(terms.effectiveTo));
  if(r.discount!==null) {
   const d=exact(r.discount,['snapshot','campaign']);
   const campaign=d.campaign,snapshot=d.snapshot;
   if(!campaign||!snapshot||snapshot.target!=='GOODS'||snapshot.amount<0||!Number.isSafeInteger(snapshot.amount)||
    snapshot.discountId!==campaign.discountId||snapshot.version!==campaign.version)return fail('COMMERCIAL_DISCOUNT_UNSUPPORTED');
   if(!['MERCHANT','PLATFORM'].includes(snapshot.source)||(snapshot.source==='MERCHANT'&&campaign.businessId!==branchId))return fail('COMMERCIAL_DISCOUNT_UNSUPPORTED');
   const from=campaign.validFrom||campaign.valid_from||campaign.startDate,to=campaign.validTo||campaign.valid_to||campaign.endDate;
   let start:number,end:number;try{start=Date.parse(new Date(from).toISOString());end=Date.parse(new Date(to).toISOString());}catch{return fail('COMMERCIAL_DISCOUNT_UNSUPPORTED');}
   if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||at<start||at>=end)return fail('COMMERCIAL_DISCOUNT_UNSUPPORTED');
   const amount=moneyFromMinor(snapshot.amount);toWholeIqdExact(amount);
   let merchantShare=snapshot.source==='MERCHANT'?amount:moneyFromMinor(0);
   const bindingKey={pk:'BRANCH#'+branchId,sk:'COMMERCIAL_SHARING#'+snapshot.source+'#'+validId(snapshot.discountId)};
   let binding:Row|undefined;try{binding=(await db.send(new GetCommand({TableName:platform,Key:bindingKey,ConsistentRead:true}))).Item;}catch{return fail();}
   if(binding){
    exact(binding,['pk','sk','ownerId','businessId','policyId','policyVersion','policyDigest']);
    if(binding.ownerId!==ownerId||binding.businessId!==branchId)return fail('DISCOUNT_FUNDING_UNAUTHORIZED');
    const policyKey={pk:'DISCOUNT_FUNDING#'+validId(binding.policyId),sk:'CURRENT'},policy=await get(staff,policyKey);
    exact(policy,['pk','sk','schemaVersion','id','version','status','campaignId','campaignVersion','source','merchantId','branchId','target','effectiveFrom','effectiveTo','merchantNumerator','denominator','rounding','merchantShareFinalRounding','acceptedBy','acceptedAt','approvedBy','approvedAt']);
    if(policy.acceptedBy!==ownerId){
     const subject=validId(policy.acceptedBy),memberKey={pk:'BRANCH#'+branchId,sk:'MEMBER#'+subject},member=await get(platform,memberKey);
     const roles=['MANAGER','BRANCH_MANAGER','LEGACY_MANAGER'];
     if(member.ownerId!==ownerId||member.subjectId!==subject||member.businessId!==branchId||member.status!=='ACTIVE'||!roles.includes(member.role)||!Number.isSafeInteger(member.version)||member.version<1)return fail('DISCOUNT_FUNDING_UNAUTHORIZED');
     if(member.permissionSchema!==undefined){
      if(member.permissionSchema!==2||member.grant?.roleId!==member.role||member.grant?.branchIds?.length!==1||member.grant.branchIds[0]!==branchId||!member.grant.permissions?.includes('branch.read'))return fail('DISCOUNT_FUNDING_UNAUTHORIZED');
     }else if(member.role!=='MANAGER')return fail('DISCOUNT_FUNDING_UNAUTHORIZED');
     operations.push(pin(platform,memberKey,member));
    }
    if(policy.schemaVersion!==3||policy.id!==binding.policyId||policy.version!==positive(binding.policyVersion)||quoteHash(policy)!==binding.policyDigest||policy.status!=='ACTIVE'||policy.merchantId!==merchantId||policy.branchId!==branchId||policy.campaignId!==snapshot.discountId||policy.source!==snapshot.source||policy.target!=='GOODS'||!quoteEntityIdValid(policy.acceptedBy)||instant(policy.acceptedAt)>at||instant(policy.approvedAt)>at||!quoteEntityIdValid(policy.approvedBy)||policy.rounding!=='MERCHANT_TOWARD_ZERO_PLATFORM_REMAINDER')return fail('DISCOUNT_FUNDING_UNAUTHORIZED');
    operations.push(pin(platform,bindingKey,binding),pin(staff,policyKey,policy));
    // Never replace agreed shared funding with a unilateral source-funded charge.
    if(policy.campaignVersion!==snapshot.version||instant(policy.effectiveFrom)!==start||instant(policy.effectiveTo)!==end)return fail('DISCOUNT_FUNDING_TERMS_CHANGED');
    if(policy.campaignVersion===snapshot.version&&instant(policy.effectiveFrom)===start&&instant(policy.effectiveTo)===end){
     if(!Number.isSafeInteger(policy.merchantNumerator)||policy.merchantNumerator<=0||policy.merchantNumerator>=positive(policy.denominator))return fail('DISCOUNT_FUNDING_UNAUTHORIZED');
     try{const final=readWholeIqdRounding(policy.merchantShareFinalRounding);if(final.mode!=='TOWARD_ZERO')return fail();merchantShare=quantizeWholeIqd(multiplyMoney(amount,policy.merchantNumerator,policy.denominator,'TOWARD_ZERO'),final);}catch{return fail('DISCOUNT_FUNDING_UNAVAILABLE');}
     fundingPolicy={id:policy.id,version:policy.version,digest:quoteHash(policy)};
    }
   }else operations.push({ConditionCheck:{TableName:platform,Key:bindingKey,ConditionExpression:'attribute_not_exists(pk)'}});
   discounts.push({id:snapshot.discountId,version:positive(snapshot.version),target:'GOODS',amount,merchantShare,platformShare:moneyFromMinor(amount.minorAmount-merchantShare.minorAmount)});
   validUntil=Math.min(validUntil,end);
  }
  exact(record.otherCharges,['merchant','platform','thirdParty']);
  const other=record.otherCharges;
  if(Object.values(other).some(v=>readMoney(v).minorAmount!==0))return fail('OTHER_COMMERCIAL_CHARGES_UNSUPPORTED');
  const calculate=(fee:unknown)=>calculateOrderCommercialPricing({schemaVersion:1,at:quote.createdAt,branchId,merchantId,goodsGross:goods.goodsGross,
   agreement:terms,goodsDiscounts:discounts,paymentMethod:'COD',customerDeliveryFee:fee,driverTip:tip,
   merchantOtherCharges:other.merchant,platformOtherCharges:other.platform,thirdPartyOtherCharges:other.thirdParty});
  let calculation=calculate(moneyFromMinor(quote.deliveryFeeMinor));
  const promotion=options.deliveryPromotion?await options.deliveryPromotion.prepare({orderId,branchId,merchantId,goodsGross:calculation.allocationInput.goodsGross,goodsAfterDiscounts:moneyFromMinor(calculation.allocationInput.goodsGross.minorAmount-calculation.allocationInput.merchantGoodsDiscount.minorAmount-calculation.allocationInput.platformGoodsDiscount.minorAmount),hasGoodsDiscount:discounts.length>0,referenceFee:moneyFromMinor(quote.deliveryFeeMinor)}):null;
  let deliveryFunding:Row|null=null;
  if(promotion){if(!Array.isArray(promotion.operations))return fail('DELIVERY_PROMOTION_UNAVAILABLE');operations.push(...promotion.operations);}
  if(promotion?.applied){
   if(promotion.agreement===true)terms={...terms,commission:copy(promotion.commission)};
   deliveryFunding=copy(promotion.deliveryFunding);calculation=calculate(readMoney(promotion.customerFee));
   const funded=allocateDeliveryFundedOrder({allocationSchemaVersion:2,base:{...calculation.allocationInput,driverEarning:moneyFromMinor(0)},deliveryFunding});
   if(funded.referenceDeliveryFee.minorAmount!==quote.deliveryFeeMinor)return fail('DELIVERY_REFERENCE_PRICE_CHANGED');
   validUntil=Math.min(validUntil,instant(promotion.validUntil));
   const {digest:_digest,...content}=calculation;
   calculation={...content,merchantPayableOnSuccessfulDelivery:funded.merchantPayable,digest:quoteHash({...content,merchantPayableOnSuccessfulDelivery:funded.merchantPayable,deliveryFunding})};
  }
  // Missing policy preserves historical calculation until the coordinated release activates it.
  const cashPolicyKey={pk:CASH_ROUNDING_PK,sk:'CURRENT'};
  let cashPolicy:Row|undefined;
  try{cashPolicy=(await db.send(new GetCommand({TableName:staff,Key:cashPolicyKey,ConsistentRead:true}))).Item;}catch{return fail('CASH_ROUNDING_POLICY_UNAVAILABLE');}
  if(!cashPolicy&&options.cashRoundingRequired===true)return fail('CASH_ROUNDING_POLICY_UNAVAILABLE');
  let cashRounding:ReturnType<typeof calculateCashRounding>|null=null;
  if(cashPolicy){
   cashRounding=calculateCashRounding({policy:cashPolicy.values,version:cashPolicy.version,paymentMethod:'COD',customerTotal:calculation.customerTotal,baseServiceFee:calculation.serviceFee.amount});
   operations.push(pin(staff,cashPolicyKey,cashPolicy));
   const {digest:_prior,...prior}=calculation;
   const content={...prior,serviceFee:{...prior.serviceFee,amount:cashRounding.serviceFee},allocationInput:{...prior.allocationInput,serviceFee:cashRounding.serviceFee},customerTotal:cashRounding.customerTotal};
   calculation={...content,digest:quoteHash({...content,cashRounding})};
  }else operations.push({ConditionCheck:{TableName:staff,Key:cashPolicyKey,ConditionExpression:'attribute_not_exists(pk)'}});
  assertMinimumOrder(promotion?.agreement===true?{minimum_order:promotion.minimumOrderAmountIqd}:branch,goods.goodsGross.minorAmount);
  const deliveryAmount=deliveryFunding?.allocation.platformShare??moneyFromMinor(0);
  const amountMinor=calculation.platformGoodsDiscountFundingRequired.minorAmount;
  const goodsExposure=options.enableFullCash&&amountMinor?prepareGoodsPromotionExposure(r.discount?.campaign,r.discount?.snapshot.source,calculation.platformGoodsDiscountFundingRequired):null;
  const funding={...(options.enableFullCash?{exposure:goodsExposure}:{}),amount:calculation.platformGoodsDiscountFundingRequired,policy:fundingPolicy,holdId:options.enableFullCash?null:amountMinor?'PROMO#'+orderId:null};
  if(!options.enableFullCash&&(amountMinor||deliveryAmount.minorAmount)) {
   if(amountMinor%1000!==0)return fail('FUNDING_WALLET_PRECISION_UNSUPPORTED');
   const walletId='WALLET#PLATFORM',walletKey={walletId,sk:'META'};
   const wallet=await get('staging-Wallets',walletKey);
   try {operations.push(...preparePlatformPromotionFunding({orderId,at:timestamp,wallet,components:[...(amountMinor?[{kind:'GOODS' as const,amount:calculation.platformGoodsDiscountFundingRequired,metadata:{agreementId,agreementVersion:version,fundingPolicy}}]:[]),...(deliveryAmount.minorAmount?[{kind:'DELIVERY' as const,amount:deliveryAmount,metadata:{policyPin:deliveryFunding!.policyPin}}]:[])]}).operations);}
   catch(error){return fail((error as any)?.code==='FUNDING_WALLET_PRECISION_UNSUPPORTED'?'FUNDING_WALLET_PRECISION_UNSUPPORTED':'DISCOUNT_FUNDING_UNAVAILABLE');}
  }
  const zone=await get('WizzCentral_Regions',{regionId:validId(quote.destinationRegionId)});
  const city=await get('WizzCentral_Regions',{regionId:validId(zone.parent_id)});
  const governorate=await get('WizzCentral_Regions',{regionId:validId(city.parent_id)});
  if(zone.level!==3||city.level!==2||governorate.level!==1||[zone,city,governorate].some(v=>![true,1,'true','1'].includes(v.is_active)))return fail();
  for(const region of [zone,city,governorate])operations.push(pin('WizzCentral_Regions',{regionId:region.regionId},region));
  const baseSnapshot=prepareDriverOfferFinancialSnapshot({snapshotId:'COMMERCIAL:'+orderId,revision:1,orderId,branchId,merchantId,
   zoneId:zone.regionId,cityId:city.regionId,governorateId:governorate.regionId,branchPoint:quote.origin,customerPoint:quote.destination,
   confirmedCustomerTotal:calculation.customerTotal,allocation:calculation.allocationInput,paymentEvidence:null});
  const financialSnapshot=options.enableFullCash?prepareFullCashOrderSnapshot({order:baseSnapshot.snapshot,deliveryFunding}):deliveryFunding?prepareDeliveryFundedFinancialSnapshot({order:baseSnapshot.snapshot,deliveryFunding}):baseSnapshot;
  if(options.enableFullCash)operations.push({Put:{TableName:'staging-Holds',Item:{orderId,sk:'FULL_CASH_FUNDING_COMMITMENT',kind:'FULL_CASH_FUNDING_COMMITMENT',settlementModel:'FULL_CASH_AT_DELIVERY_V1',status:'COMMITTED',branchId,merchantId,snapshotDigest:financialSnapshot.digest,deliveryFunding,goodsExposure,...(cashRounding?{cashRounding}:{}),platformGoodsFunding:calculation.platformGoodsDiscountFundingRequired,agreement:{id:agreementId,version,termsHash:record.termsHash},createdAt:timestamp},ConditionExpression:'attribute_not_exists(orderId)'}});
  const branchFields=['businessId','ownerId','cognitoUserId','organizationId','commercialAgreementId','commercialAgreementVersion','regionPath',
   'status','isActive','onboardingSchemaVersion','onboardingComplete','acceptingOrders','platformSuspended','ordersBlocked','deletionRequestId','minimum_order'];
  const branchCondition=pin('WhizzMerchants_Businesses',{businessId:branchId},branch,branchFields);
  const preview={...(promotion?.agreement===true?{deliveryAgreement:{...promotion.deliveryFunding.policyPin,kind:promotion.customerRule}}:{}),...(options.enableFullCash?{settlementModel:'FULL_CASH_AT_DELIVERY_V1'}:{}),...(promotion?.benefitReceipt?{platformBenefitReceipt:copy(promotion.benefitReceipt)}:{}),schemaVersion:deliveryFunding?2:1,...(promotion?.cashRoundingEvidence?{deliveryCashRounding:copy(promotion.cashRoundingEvidence)}:{}),...(deliveryFunding?{deliveryFunding}:{}),kind:'COMMERCIAL_CHECKOUT',orderId,branchId,merchantId,expiresAt:new Date(validUntil).toISOString(),
   ...(cashRounding?{cashRounding}:{}),goodsFingerprint:goods.fingerprint,agreement:{id:agreementId,version,termsHash:record.termsHash},funding,
   calculation,financialSnapshot,branchCondition};
  return copy({...preview,digest:quoteHash(preview),goodsLines:goods.lines,operations,requiresAtomicCommit:true});
 }});
}
