import {parseIqd,readMoney,moneyFromMinor,toWholeIqdExact} from './money';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
type Row=Record<string,any>;
const fail=():never=>{throw Object.assign(Error('PLATFORM_GOODS_EXPOSURE_LIMIT_REQUIRED'),{code:'PLATFORM_GOODS_EXPOSURE_LIMIT_REQUIRED',statusCode:409});};
/** A finite usage CAS and a per-use money cap bound aggregate campaign exposure.
 * No wallet cash is reserved. The order writer must commit the campaign usage CAS.
 */
export function prepareGoodsPromotionExposure(campaign:Row,source:string,amount:unknown){
 const actual=readMoney(amount);toWholeIqdExact(actual);if(actual.minorAmount<=0||!quoteEntityIdValid(campaign?.discountId)||!Number.isSafeInteger(campaign.version)||campaign.version<1||!['MERCHANT','PLATFORM'].includes(source))return fail();
 const rawLimit=source==='MERCHANT'?campaign.usage_limit??campaign.usageLimit:campaign.usageLimit??campaign.limit;
 const limit=typeof rawLimit==='string'&&/^\d+$/.test(rawLimit)?Number(rawLimit):rawLimit;
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
 if(!value||value.schemaVersion!==1||value.kind!=='GOODS_PROMOTION_EXPOSURE'||value.enforcement!=='ATOMIC_CAMPAIGN_USAGE_CAS_AT_ORDER_COMMIT')return fail();
 const {digest,...body}=value;if(digest!==quoteHash(body)||quoteHash(readMoney(value.platformAmount))!==quoteHash(readMoney(amount)))return fail();
 const rebuilt=prepareGoodsPromotionExposure({discountId:value.campaignId,version:value.campaignVersion,type:'fixedAmount',value:toWholeIqdExact(value.perUseCap),usage_limit:value.usageLimit,usageLimit:value.usageLimit},value.source,amount);
 if(quoteHash(rebuilt)!==quoteHash(value))return fail();return rebuilt;
}
