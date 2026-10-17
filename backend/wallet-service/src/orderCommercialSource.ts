import {DynamoDBDocumentClient, GetCommand} from '@aws-sdk/lib-dynamodb';
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
export function createStagingCommercialSource(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number}) {
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
  const terms=record.terms;
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
   const policyId=validId(campaign.fundingPolicyId),policyVersion=positive(campaign.fundingPolicyVersion);
   if(!record.allowedFundingPolicyIds.includes(policyId))return fail('DISCOUNT_FUNDING_UNAUTHORIZED');
   const policyKey={pk:'DISCOUNT_FUNDING#'+policyId,sk:'CURRENT'};
   const policy=await get(staff,policyKey);
   exact(policy,['pk','sk','schemaVersion','id','version','status','campaignId','campaignVersion','source','merchantId','branchId',
    'target','effectiveFrom','effectiveTo','merchantNumerator','denominator','rounding','approvedBy','approvedAt',...(policy.schemaVersion===2?['merchantShareFinalRounding']:[])]);
   if(![1,2].includes(policy.schemaVersion)||policy.id!==policyId||policy.version!==policyVersion||policy.status!=='ACTIVE'||
    policy.campaignId!==snapshot.discountId||policy.campaignVersion!==snapshot.version||policy.source!==snapshot.source||
    policy.merchantId!==merchantId||policy.branchId!==branchId||policy.target!=='GOODS'||policy.rounding!=='MERCHANT_TOWARD_ZERO_PLATFORM_REMAINDER'||
    at<instant(policy.effectiveFrom)||at>=instant(policy.effectiveTo)||!quoteEntityIdValid(policy.approvedBy)||instant(policy.approvedAt)>at||
    !Number.isSafeInteger(policy.merchantNumerator)||policy.merchantNumerator<0||policy.merchantNumerator>positive(policy.denominator))return fail();
   if(record.schemaVersion===2){const accepted=record.fundingPolicySnapshots.find((v:Row)=>v.id===policyId);if(!accepted||accepted.version!==policy.version||accepted.digest!==quoteHash(policy))return fail('DISCOUNT_FUNDING_UNAUTHORIZED');}
   const amount=moneyFromMinor(snapshot.amount),rawMerchantShare=multiplyMoney(amount,policy.merchantNumerator,policy.denominator,'TOWARD_ZERO');
   let merchantShare=rawMerchantShare;
   if(policy.schemaVersion===2){
    try{
     toWholeIqdExact(amount);
     const final=readWholeIqdRounding(policy.merchantShareFinalRounding);
     if(final.mode!=='TOWARD_ZERO')return fail();
     merchantShare=quantizeWholeIqd(rawMerchantShare,final);
    }catch{return fail('DISCOUNT_FUNDING_UNAVAILABLE');}
   }
   discounts.push({id:snapshot.discountId,version:positive(snapshot.version),target:'GOODS',amount,merchantShare,
    platformShare:moneyFromMinor(amount.minorAmount-merchantShare.minorAmount)});
   validUntil=Math.min(validUntil,instant(policy.effectiveTo));
   fundingPolicy={id:policy.id,version:policy.version,digest:quoteHash(policy)};
   operations.push(pin(staff,policyKey,policy));
  }
  exact(record.otherCharges,['merchant','platform','thirdParty']);
  const other=record.otherCharges;
  if(Object.values(other).some(v=>readMoney(v).minorAmount!==0))return fail('OTHER_COMMERCIAL_CHARGES_UNSUPPORTED');
  const calculation=calculateOrderCommercialPricing({schemaVersion:1,at:quote.createdAt,branchId,merchantId,goodsGross:goods.goodsGross,
   agreement:terms,goodsDiscounts:discounts,paymentMethod:'COD',customerDeliveryFee:moneyFromMinor(quote.deliveryFeeMinor),driverTip:tip,
   merchantOtherCharges:other.merchant,platformOtherCharges:other.platform,thirdPartyOtherCharges:other.thirdParty});
  const amountMinor=calculation.platformGoodsDiscountFundingRequired.minorAmount;
  const funding={amount:calculation.platformGoodsDiscountFundingRequired,policy:fundingPolicy,holdId:amountMinor?'PROMO#'+orderId:null};
  if(amountMinor) {
   if(amountMinor%1000!==0)return fail('FUNDING_WALLET_PRECISION_UNSUPPORTED');
   const amount=amountMinor/1000,walletId='WALLET#PLATFORM',walletKey={walletId,sk:'META'};
   const wallet=await get('staging-Wallets',walletKey);
   if(wallet.walletId!==walletId||wallet.sk!=='META'||wallet.ownerType!=='PLATFORM'||wallet.status!=='ACTIVE'||wallet.currency!=='IQD'||
    !Number.isSafeInteger(wallet.availableBalance)||!Number.isSafeInteger(wallet.lockedBalance)||wallet.lockedBalance<0||
    wallet.availableBalance<amount||!Number.isSafeInteger(wallet.availableBalance+wallet.lockedBalance)||!Number.isSafeInteger(wallet.lockedBalance+amount)||!Number.isSafeInteger(wallet.version)||wallet.version<1||wallet.version>=Number.MAX_SAFE_INTEGER)
    return fail('DISCOUNT_FUNDING_UNAVAILABLE');
   const check=pin('staging-Wallets',walletKey,wallet,['walletId','sk','ownerType','ownerId','status','currency','availableBalance','lockedBalance','version']).ConditionCheck;
   operations.push({Update:{...check,UpdateExpression:'SET availableBalance=:available, lockedBalance=:locked, #wv=:next, updatedAt=:at',
    ExpressionAttributeNames:{...check.ExpressionAttributeNames,'#wv':'version'},ExpressionAttributeValues:{...check.ExpressionAttributeValues,
     ':available':wallet.availableBalance-amount,':locked':wallet.lockedBalance+amount,':next':wallet.version+1,':at':timestamp}}});
   // Separate key from driver HOLD: generic driver release/capture endpoints cannot address this reservation.
   const holdId='PROMO#'+orderId;
   operations.push({Put:{TableName:'staging-Holds',Item:{orderId,sk:'PROMOTION_FUNDING',holdId,walletId,amount,status:'ACTIVE',
    purpose:'PLATFORM_GOODS_DISCOUNT',statusCreatedAt:'ACTIVE#'+timestamp,createdAt:timestamp,updatedAt:timestamp,
    metadata:{orderId,agreementId,agreementVersion:version,fundingPolicy}},ConditionExpression:'attribute_not_exists(orderId)'}});
   operations.push({Put:{TableName:'staging-AuditLog',Item:{logId:holdId,sk:timestamp+'#'+holdId,
    datePartition:'date#'+timestamp.slice(0,10).replace(/-/g,''),actorId:'SYSTEM_COMMERCIAL_ORDER',targetId:orderId,createdAt:timestamp,action:'PROMOTION_FUNDING_RESERVED',walletId,orderId,holdId,
    amount,currency:'IQD',timestamp,metadata:{agreementId,agreementVersion:version,fundingPolicy}},ConditionExpression:'attribute_not_exists(sk)'}});
   for(const bucket of ['AVAILABLE','LOCKED']) {
    const debit=bucket==='AVAILABLE',balance=debit?wallet.availableBalance:wallet.lockedBalance;
    operations.push({Put:{TableName:'staging-LedgerEntries',Item:{walletId,sk:`ts#${timestamp}#PROMO_${bucket}#${orderId}`,
     transactionId:holdId,type:debit?'DEBIT':'CREDIT',category:'HOLD_CREATED',amount:debit?-amount:amount,
     balanceBefore:balance,balanceAfter:balance+(debit?-amount:amount),relatedEntityId:orderId,relatedEntityType:'HOLD',
     metadata:{orderId,holdId,balanceType:bucket,purpose:'PLATFORM_GOODS_DISCOUNT'},createdAt:timestamp},ConditionExpression:'attribute_not_exists(sk)'}});
   }
  }
  const zone=await get('WizzCentral_Regions',{regionId:validId(quote.destinationRegionId)});
  const city=await get('WizzCentral_Regions',{regionId:validId(zone.parent_id)});
  const governorate=await get('WizzCentral_Regions',{regionId:validId(city.parent_id)});
  if(zone.level!==3||city.level!==2||governorate.level!==1||[zone,city,governorate].some(v=>![true,1,'true','1'].includes(v.is_active)))return fail();
  for(const region of [zone,city,governorate])operations.push(pin('WizzCentral_Regions',{regionId:region.regionId},region));
  const financialSnapshot=prepareDriverOfferFinancialSnapshot({snapshotId:'COMMERCIAL:'+orderId,revision:1,orderId,branchId,merchantId,
   zoneId:zone.regionId,cityId:city.regionId,governorateId:governorate.regionId,branchPoint:quote.origin,customerPoint:quote.destination,
   confirmedCustomerTotal:calculation.customerTotal,allocation:calculation.allocationInput,paymentEvidence:null});
  const branchFields=['businessId','ownerId','cognitoUserId','organizationId','commercialAgreementId','commercialAgreementVersion','regionPath',
   'status','isActive','onboardingSchemaVersion','onboardingComplete','acceptingOrders','platformSuspended','ordersBlocked','deletionRequestId'];
  const branchCondition=pin('WhizzMerchants_Businesses',{businessId:branchId},branch,branchFields);
  const preview={schemaVersion:1,kind:'COMMERCIAL_CHECKOUT',orderId,branchId,merchantId,expiresAt:new Date(validUntil).toISOString(),
   goodsFingerprint:goods.fingerprint,agreement:{id:agreementId,version,termsHash:record.termsHash},funding,
   calculation,financialSnapshot,branchCondition};
  return copy({...preview,digest:quoteHash(preview),goodsLines:goods.lines,operations,requiresAtomicCommit:true});
 }});
}
