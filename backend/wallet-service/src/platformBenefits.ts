import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {moneyFromMinor} from './money';
import {allocateDeliveryFunding} from './deliveryFunding';
type Row=Record<string,any>;
type DB={send:(command:any)=>Promise<any>};
export const BENEFIT_TABLE='staging-WizzOfferJourney';
export const BENEFIT_POLICY_PREFIX='PLATFORM_BENEFIT#';
function fail(code:string):never {throw Object.assign(Error(code),{code,statusCode:409,status:409});}
const integer=(v:any,min=0)=>{if(!Number.isSafeInteger(v)||v<min||v>Number.MAX_SAFE_INTEGER)fail('BENEFIT_INVALID');return v as number;};
const exact=(v:any,keys:string[])=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))fail('BENEFIT_INVALID');};
const id=(v:any)=>{if(!quoteEntityIdValid(v))fail('BENEFIT_INVALID');return v as string;};
const quantum=(v:any,min=0)=>{integer(v,min);if(v>1e9||v%250!==0)fail('BENEFIT_DENOMINATION_INVALID');return v as number;};
const ids=(v:any)=>{if(!Array.isArray(v)||v.length>100||new Set(v).size!==v.length)fail('BENEFIT_INVALID');v.forEach(id);};
export function readPlatformBenefit(value:any){
 exact(value,['schemaVersion','kind','amountIqd','usesPerCustomer','maximumPerOrderIqd','minimumGoodsIqd','maximumRoadMeters','grantMode','audience','branchIds','regionIds','customerIds','allowGoodsStacking']);
 if(value.schemaVersion!==1||!['FREE_DELIVERIES','GOODS_AMOUNT','DELIVERY_AMOUNT'].includes(value.kind)||!['AUTO','DIRECT'].includes(value.grantMode)||!['ALL','NEW_CUSTOMER','FIRST_ORDER','RETURNING','VIP','INACTIVE'].includes(value.audience)||typeof value.allowGoodsStacking!=='boolean')fail('BENEFIT_INVALID');
 quantum(value.amountIqd);integer(value.usesPerCustomer,1);if(value.usesPerCustomer>1000)fail('BENEFIT_INVALID');quantum(value.maximumPerOrderIqd,250);quantum(value.minimumGoodsIqd);integer(value.maximumRoadMeters,1);
 if(value.maximumRoadMeters>200000||value.kind==='FREE_DELIVERIES'&&value.amountIqd!==0||value.kind!=='FREE_DELIVERIES'&&(!value.amountIqd||value.amountIqd>value.maximumPerOrderIqd)||value.kind==='GOODS_AMOUNT'&&value.usesPerCustomer!==1)fail('BENEFIT_INVALID');
 for(const key of ['branchIds','regionIds','customerIds']){ids(value[key]);if(key!=='customerIds'&&value[key].length>20)fail('BENEFIT_TARGET_LIMIT');}
 return JSON.parse(JSON.stringify(value)) as Row;
}

export const benefitGrantKey=(campaignId:string,sub:string)=>({pk:'USER#'+id(sub),sk:'BENEFIT#'+id(campaignId)});
const holdKey=(orderId:string,target:string)=>({pk:'BENEFIT_ORDER#'+id(orderId),sk:target});
const get=async(db:DB,key:Row)=>(await db.send(new GetCommand({TableName:BENEFIT_TABLE,Key:key,ConsistentRead:true}))).Item as Row|undefined;
function write(next:Row,before?:Row){return {Put:{TableName:BENEFIT_TABLE,Item:next,...(before?{ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':before.version}}:{ConditionExpression:'attribute_not_exists(pk)'})}};}

function grantValid(g:Row){integer(g.version,1);integer(g.grantedUses,1);integer(g.reservedUses);integer(g.usedUses);if(typeof g.revoked!=='boolean'||g.reservedUses+g.usedUses>g.grantedUses)fail('BENEFIT_GRANT_INVALID');}

export type BenefitFacts={sub:string;branchId?:string;regionIds:string[];goodsMinor?:number;roadMeters?:number;firstOrder:boolean;newCustomer:boolean;vip:boolean;inactive:boolean};
export function platformBenefitEligibility(campaign:Row,facts:BenefitFacts,at=Date.now()){
 const b=readPlatformBenefit(campaign.benefit);id(facts.sub);id(campaign.discountId);integer(campaign.version,1);

 if(b.customerIds.length&&!b.customerIds.includes(facts.sub))return 'BENEFIT_NOT_ELIGIBLE';
 if(b.branchIds.length&&facts.branchId&&!b.branchIds.includes(facts.branchId))return 'BENEFIT_WRONG_BRANCH';
 if(b.regionIds.length&&!b.regionIds.some((x:string)=>facts.regionIds.includes(x)))return 'BENEFIT_WRONG_REGION';
 if((b.audience==='FIRST_ORDER'&&!facts.firstOrder)||(b.audience==='NEW_CUSTOMER'&&!facts.newCustomer)||(b.audience==='RETURNING'&&facts.firstOrder)||(b.audience==='VIP'&&!facts.vip)||(b.audience==='INACTIVE'&&!facts.inactive))return 'BENEFIT_NOT_ELIGIBLE';
 if(campaign.status==='paused')return 'BENEFIT_PAUSED';
 if(campaign.status!=='active'||campaign.isActive!==true||campaign.isDeleted||campaign.deletedAt||!Number.isFinite(Date.parse(campaign.startDate))||!Number.isFinite(Date.parse(campaign.endDate))||at<Date.parse(campaign.startDate)||at>=Date.parse(campaign.endDate))return 'BENEFIT_EXPIRED';
 if(facts.goodsMinor!==undefined&&integer(facts.goodsMinor)<b.minimumGoodsIqd*1000)return 'BENEFIT_MINIMUM_ORDER';
 if(facts.roadMeters!==undefined&&integer(facts.roadMeters)>b.maximumRoadMeters)return 'BENEFIT_DISTANCE_EXCEEDED';
 return null;
}
export async function platformBenefitBalance(db:DB,campaign:Row,sub:string){
 const b=readPlatformBenefit(campaign.benefit),grant=await get(db,benefitGrantKey(campaign.discountId,sub));
 if(grant)grantValid(grant);
 const granted=grant?.grantedUses??(b.grantMode==='AUTO'?b.usesPerCustomer:0),reserved=grant?.reservedUses??0,used=grant?.usedUses??0;
 return {grant,granted,reserved,used,remaining:grant?.revoked?0:Math.max(0,granted-reserved-used),revoked:grant?.revoked===true};
}
export async function preparePlatformBenefit(db:DB,input:{campaign:Row;facts:BenefitFacts;orderId?:string;referenceDeliveryMinor?:number;hasGoodsDiscount?:boolean;preview?:boolean;now?:number}){
 const {campaign,facts}=input,b=readPlatformBenefit(campaign.benefit),at=input.now??Date.now();
 const reason=platformBenefitEligibility(campaign,facts,at);if(reason)fail(reason);
 if(!facts.branchId||facts.goodsMinor===undefined)fail('BENEFIT_CART_REQUIRED');
 if(b.kind!=='GOODS_AMOUNT'&&input.hasGoodsDiscount&&!b.allowGoodsStacking)fail('BENEFIT_STACKING_DENIED');
 const reference=input.referenceDeliveryMinor??0;integer(reference);
 let amount:number;
 if(b.kind==='GOODS_AMOUNT')amount=Math.floor(Math.min(b.amountIqd*1000,facts.goodsMinor)/250000)*250000;
 else {
  if(reference%250000!==0)fail('BENEFIT_DELIVERY_TARIFF_UNSUPPORTED');
  if(b.kind==='FREE_DELIVERIES'&&reference>b.maximumPerOrderIqd*1000)fail('BENEFIT_DELIVERY_CAP_EXCEEDED');
  amount=b.kind==='FREE_DELIVERIES'?reference:Math.min(reference,b.amountIqd*1000);
 }
 if(!amount)fail('BENEFIT_NO_SAVINGS');if(amount>b.maximumPerOrderIqd*1000)fail('BENEFIT_CAP_EXCEEDED');
 const balance=await platformBenefitBalance(db,campaign,facts.sub);if(balance.revoked||balance.remaining<1)fail('BENEFIT_EXHAUSTED');
 const target=b.kind==='GOODS_AMOUNT'?'GOODS':'DELIVERY',operations:Row[]=[];
 const grant=balance.grant??{...benefitGrantKey(campaign.discountId,facts.sub),version:0,grantedUses:balance.granted,reservedUses:0,usedUses:0,revoked:false};
 const termsHash=quoteHash({campaignId:campaign.discountId,benefit:b,startDate:campaign.startDate,endDate:campaign.endDate});
 const deliveryFunding=target==='DELIVERY'?{policyPin:{policyId:BENEFIT_POLICY_PREFIX+campaign.discountId,version:campaign.version,termsHash},allocation:allocateDeliveryFunding({schemaVersion:1,referenceFee:moneyFromMinor(reference),customerFee:moneyFromMinor(reference-amount),funding:{kind:'PLATFORM'}})}:null;
 if(!input.preview){
  const orderId=id(input.orderId),key=holdKey(orderId,target),previous=await get(db,key);
  if(previous)fail('BENEFIT_ORDER_RECOVERY_REQUIRED');
  operations.push(write({...grant,version:integer(grant.version+1,1),reservedUses:grant.reservedUses+1},balance.grant),write({...key,version:1,campaignId:campaign.discountId,sub:facts.sub,orderId,target,amountMinor:amount,status:'RESERVED',deliveryFunding,createdAt:new Date(at).toISOString()}));
 }
 return {amountMinor:amount,target,deliveryFunding,customerFee:moneyFromMinor(reference-(target==='DELIVERY'?amount:0)),operations,receipt:{schemaVersion:1,campaignId:campaign.discountId,target,termsHash},validUntil:campaign.endDate};
}
/** Returned operations must join the caller's existing authorized order transaction. */
export async function settlePlatformBenefit(db:DB,input:{orderId:string;target:string;outcome:'CAPTURED'|'RELEASED';keepUse?:boolean;expectedFunding?:Row}){
 const key=holdKey(input.orderId,input.target),h=await get(db,key);if(!h)fail('BENEFIT_RESERVATION_MISSING');
 if(h.orderId!==input.orderId||h.target!==input.target||!['GOODS','DELIVERY'].includes(h.target))fail('BENEFIT_RESERVATION_INVALID');integer(h.version,1);integer(h.amountMinor,1);id(h.campaignId);id(h.sub);
 if(input.expectedFunding&&quoteHash(input.expectedFunding)!==quoteHash(h.deliveryFunding))fail('BENEFIT_RESERVATION_INVALID');
 const keep=input.outcome==='CAPTURED'||input.keepUse===true,status=input.outcome+(keep?'_USED':'');
 if(h.status===status)return {replayed:true,operations:[] as Row[]};if(h.status!=='RESERVED')fail('BENEFIT_RESERVATION_CONFLICT');
 const grant=await get(db,benefitGrantKey(h.campaignId,h.sub));if(!grant)fail('BENEFIT_RESERVATION_INVALID');grantValid(grant);
 if(grant.reservedUses<1)fail('BENEFIT_RESERVATION_INVALID');
 return {replayed:false,operations:[write({...grant,version:integer(grant.version+1,1),reservedUses:grant.reservedUses-1,usedUses:grant.usedUses+(keep?1:0)},grant),write({...h,version:integer(h.version+1,1),status},h)]};
}
