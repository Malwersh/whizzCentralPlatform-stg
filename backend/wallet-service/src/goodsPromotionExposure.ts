import {readMoney,toWholeIqdExact,parseIqd,moneyFromMinor} from './money';
import {quoteEntityIdValid,quoteHash} from './deliveryQuoteRecord';
import {readPlatformBenefit} from './platformBenefits';
type Row=Record<string,any>;
const fail=():never=>{throw Object.assign(Error('PLATFORM_GOODS_EXPOSURE_LIMIT_REQUIRED'),{code:'PLATFORM_GOODS_EXPOSURE_LIMIT_REQUIRED',statusCode:409});};
/** Retains the published campaign-usage contract. Gifts are bounded by recipient entitlement instead. */
export function prepareGoodsPromotionExposure(campaign:Row,source:string,amount:unknown){
 const actual=readMoney(amount);toWholeIqdExact(actual);
 if(actual.minorAmount<=0||!quoteEntityIdValid(campaign?.discountId)||!Number.isSafeInteger(campaign.version)||campaign.version<1||!['MERCHANT','PLATFORM'].includes(source))return fail();
 if(campaign.benefit){
  const b=readPlatformBenefit(campaign.benefit);
  if(source!=='PLATFORM'||b.kind!=='GOODS_AMOUNT'||actual.minorAmount>Math.min(b.amountIqd,b.maximumPerOrderIqd)*1000)return fail();
  const body={schemaVersion:2,kind:'GOODS_BENEFIT_EXPOSURE',campaignId:campaign.discountId,campaignVersion:campaign.version,source,perUseCap:moneyFromMinor(Math.min(b.amountIqd,b.maximumPerOrderIqd)*1000),usesPerCustomer:b.usesPerCustomer,platformAmount:actual,enforcement:'ATOMIC_RECIPIENT_ENTITLEMENT_AT_ORDER_COMMIT'};
  return {...body,digest:quoteHash(body)};
 }
 const raw=source==='MERCHANT'?campaign.usage_limit??campaign.usageLimit:campaign.usageLimit??campaign.limit;
 const limit=typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):raw;
 if(!Number.isSafeInteger(limit)||limit<1)return fail();
 const type=String(campaign.type??campaign.discountType??'').toLowerCase();
 const capValue=['fixedamount','fixed_amount','fixed'].includes(type)?campaign.value??campaign.discountValue:campaign.maxDiscountAmount??campaign.maxDiscount;
 let cap;try{cap=parseIqd(String(capValue));toWholeIqdExact(cap);}catch{return fail();}
 const total=BigInt(cap.minorAmount)*BigInt(limit);
 if(cap.minorAmount<=0||actual.minorAmount>cap.minorAmount||total>BigInt(Number.MAX_SAFE_INTEGER))return fail();
 const body={schemaVersion:1,kind:'GOODS_PROMOTION_EXPOSURE',campaignId:campaign.discountId,campaignVersion:campaign.version,source,usageLimit:limit,perUseCap:cap,maximumCampaignExposure:moneyFromMinor(Number(total)),platformAmount:actual,enforcement:'ATOMIC_CAMPAIGN_USAGE_CAS_AT_ORDER_COMMIT'};
 return {...body,digest:quoteHash(body)};
}
export function verifyGoodsPromotionExposure(value:Row,amount:unknown){
 if(!value)return fail();const {digest,...body}=value;
 if(digest!==quoteHash(body)||quoteHash(readMoney(value.platformAmount))!==quoteHash(readMoney(amount)))return fail();
 if(value.schemaVersion===2){
  if(value.kind!=='GOODS_BENEFIT_EXPOSURE'||value.source!=='PLATFORM'||value.enforcement!=='ATOMIC_RECIPIENT_ENTITLEMENT_AT_ORDER_COMMIT'||!quoteEntityIdValid(value.campaignId)||!Number.isSafeInteger(value.campaignVersion)||value.campaignVersion<1||value.usesPerCustomer!==1)return fail();
  const cap=toWholeIqdExact(readMoney(value.perUseCap)),actual=toWholeIqdExact(readMoney(amount));
  if(cap<=0||cap%250||actual<=0||actual%250||actual>cap)return fail();return value;
 }
 if(value.schemaVersion!==1||value.kind!=='GOODS_PROMOTION_EXPOSURE'||value.enforcement!=='ATOMIC_CAMPAIGN_USAGE_CAS_AT_ORDER_COMMIT')return fail();
 const rebuilt=prepareGoodsPromotionExposure({discountId:value.campaignId,version:value.campaignVersion,type:'fixedAmount',value:toWholeIqdExact(value.perUseCap),usage_limit:value.usageLimit,usageLimit:value.usageLimit},value.source,amount);
 if(quoteHash(rebuilt)!==quoteHash(value))return fail();return rebuilt;
}
