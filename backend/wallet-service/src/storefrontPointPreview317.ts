import {createHash} from 'node:crypto';
import {GetCommand,QueryCommand,TransactWriteCommand,DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {createStagingDeliveryPricingContext} from './deliveryPricingContext';
import {createStagingDeliveryFundingReader} from './deliveryFundingReader';
import {calculateStoreDeliveryAgreement} from './storeDeliveryAgreement';
import {minimumOrderIqd} from './branchMinimumOrder';
import {quoteEntityIdValid} from './deliveryQuoteRecord';
import type {createCoveredDeliveryRouter} from './roadRouting';
type Row=Record<string,any>;
const fail=(code:string,statusCode=503):never=>{throw Object.assign(Error(code),{code,statusCode});};
export function pointSelection317(value:unknown){
 const r=value as Row,p=r?.point;
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join(',')!=='branchId,point,regionId'||!quoteEntityIdValid(r.branchId)||!quoteEntityIdValid(r.regionId)||!p||Object.keys(p).sort().join(',')!=='latitude,longitude'||typeof p.latitude!=='number'||typeof p.longitude!=='number'||!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180) return fail('INVALID_STOREFRONT_REQUEST',400);
 return {branchId:r.branchId as string,regionId:r.regionId as string,point:{latitude:p.latitude as number,longitude:p.longitude as number}};
}
/** Public informational prices only. No address/profile/order/wallet/budget writes and no quote IDs. */
export function createStagingPointStorefrontPreview317(options:{db:Pick<DynamoDBDocumentClient,'send'>;createRouter:(db:Pick<DynamoDBDocumentClient,'send'>)=>ReturnType<typeof createCoveredDeliveryRouter>;now?:()=>number}){
 const db=options.db,now=options.now??Date.now;
 return {async preview(value:unknown){
  const r=pointSelection317(value);
  const context=createStagingDeliveryPricingContext({db,authenticateCustomer:async()=>{throw Error('PUBLIC_PREVIEW_IS_NOT_CUSTOMER_AUTH');},router:options.createRouter(db),now,pointPreview:{point:r.point,regionId:r.regionId}});
  const priced=await context.calculate({branchId:r.branchId,addressId:'POINT_PREVIEW'});
  let fee=priced.calculation.customerDeliveryFee,minimum=minimumOrderIqd({minimum_order:priced.minimumOrderAmountIqd}),mode='CALCULATED';
  const rule=priced.pricingRequest.rules.find(x=>x.id===priced.calculation.rule.id&&x.version===priced.calculation.rule.version);
  if(!rule||(rule.effectiveTo!==null&&typeof rule.effectiveTo!=='string'))return fail('PRICING_CONTEXT_CHANGED');
  let expires=Math.min(Date.parse(priced.binding.route.expiresAt),rule.effectiveTo===null?Infinity:Date.parse(rule.effectiveTo as string));
  // Resolve genuine accepted agreements through the same lifecycle/terms reader as checkout.
  // Personal campaigns are intentionally deferred until an authenticated basket exists.
  if(priced.context.merchantId!=='UNBOUND_MERCHANT'){
   const branch=(await db.send(new GetCommand({TableName:'WhizzMerchants_Businesses',Key:{businessId:r.branchId},ConsistentRead:true}))).Item;
   if(!branch||branch.organizationId!==priced.context.merchantId)return fail('DELIVERY_POLICY_UNAVAILABLE');
   const reader=createStagingDeliveryFundingReader({db,now,lifecycleReadMode:'GET'});
   let cursor:Row|undefined,count=0,active=0;const seen=new Set<string>();const matches:Row[]=[];
   for(let page=0;page<4;page++){
    const q=await db.send(new QueryCommand({TableName:'staging-MerchantPlatform',KeyConditionExpression:'pk=:pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':'BRANCH#'+r.branchId,':prefix':'COMMERCIAL#DELIVERY#'},ConsistentRead:true,Limit:25,...(cursor?{ExclusiveStartKey:cursor}:{})}));
    for(const index of q.Items??[]){
     if(++count>50)return fail('DELIVERY_POLICY_SELECTION_LIMIT');
     if(index.pk!=='BRANCH#'+r.branchId||index.kind!=='DELIVERY'||index.ownerId!==branch.ownerId||index.businessId!==r.branchId||typeof index.recordPk!=='string'||!index.recordPk.startsWith('DELIVERY_FUNDING#')||seen.has(index.recordPk))return fail('DELIVERY_POLICY_SCOPE_MISMATCH');seen.add(index.recordPk);
     const current=(await db.send(new GetCommand({TableName:'staging-PlatformStaff',Key:{pk:index.recordPk,sk:'CURRENT'},ConsistentRead:true}))).Item;
     if(!current)continue;
     if(index.sk!=='COMMERCIAL#DELIVERY#'+current.id||index.recordPk!=='DELIVERY_FUNDING#'+current.id)return fail('DELIVERY_POLICY_SCOPE_MISMATCH');
     if(current.status!=='ACTIVE'||Date.parse(current.policy?.effectiveFrom)>now()||Date.parse(current.policy?.effectiveTo)<=now())continue;
     if(++active>8)return fail('DELIVERY_POLICY_SELECTION_LIMIT');
     const resolved=await reader.prepare({branchId:r.branchId,policyPin:{policyId:current.id,version:current.version,termsHash:current.termsHash}});
     if(resolved.policy.schemaVersion===2&&resolved.policy.eligibility.regionIds.includes(r.regionId))matches.push(resolved);
    }
    cursor=q.LastEvaluatedKey;if(!cursor)break;
   }
   if(cursor)return fail('DELIVERY_POLICY_SELECTION_LIMIT');
   if(matches.length>1)return fail('DELIVERY_AGREEMENT_OVERLAP');
   if(matches.length===1){const match=matches[0];fee=calculateStoreDeliveryAgreement(match.policy,fee).allocation.customerFee;minimum=minimumOrderIqd({minimum_order:match.policy.eligibility.minimumGoods.minorAmount/1000});mode=match.policy.customerRule.kind;expires=Math.min(expires,Date.parse(match.validUntil));}
  }
  if(!Number.isFinite(expires)||expires<=now())return fail('PRICING_CONTEXT_CHANGED');
  const prep=priced.preparationMinutes,minutes=Number.isInteger(prep)&&prep>=5&&prep<=120?prep:null;
  return {schemaVersion:1,kind:'STOREFRONT_PREVIEW',branchId:r.branchId,destination:r.point,regionId:r.regionId,createdAt:new Date(now()).toISOString(),expiresAt:new Date(expires).toISOString(),policyVersion:priced.policyVersion,pricingMode:mode,customerDeliveryFee:fee,minimumOrderAmountIqd:minimum,preparationMinutes:minutes,roadDistanceMeters:priced.binding.route.distanceMeters,deliveryDurationSeconds:priced.binding.route.durationSeconds,arrivalMinutes:minutes===null?null:{minimum:minutes+Math.ceil(priced.binding.route.durationSeconds/60),maximum:minutes+Math.ceil(priced.binding.route.durationSeconds/60)+5},requiresFinalConfirmation:true,informationalOnly:true};
 }};
}
/** Trusted gateway source IP is hashed; no address-book or customer identity is created. */
export async function reservePublicPointPreview317(options:{db:Pick<DynamoDBDocumentClient,'send'>;sourceIp:string;maxPerMinute:number;now?:()=>number}){
 const now=options.now??Date.now;
 if(!options.sourceIp||options.sourceIp.length>100||!Number.isSafeInteger(options.maxPerMinute)||options.maxPerMinute<1||options.maxPerMinute>120)return fail('QUOTE_RATE_UNAVAILABLE');
 const digest=createHash('sha256').update(options.sourceIp).digest('hex');
 const key={pk:'PUBLIC_POINT_PREVIEW#'+digest,sk:'RATE#317'},window=Math.floor(now()/60000)*60000;
 for(let attempt=0;attempt<3;attempt++){
  const old=(await options.db.send(new GetCommand({TableName:'staging-StorefrontPointPreviewRate',Key:key,ConsistentRead:true}))).Item;
  if(old&&(old.pk!==key.pk||old.sk!==key.sk||!Number.isSafeInteger(old.window)||old.window<0||old.window%60000!==0||!Number.isSafeInteger(old.count)||old.count<1||old.count>120||!Number.isSafeInteger(old.window)||old.window>window||!Number.isSafeInteger(old.version)||old.version<1||old.version>=Number.MAX_SAFE_INTEGER))return fail('QUOTE_RATE_UNAVAILABLE');
  const count=old?.window===window?old.count:0;
  if(count>=options.maxPerMinute)return fail('QUOTE_RATE_LIMITED',429);
  try{await options.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'staging-StorefrontPointPreviewRate',Item:{...key,window,count:count+1,version:(old?.version??0)+1,expiresAtEpoch:Math.floor(now()/1000)+86400},ConditionExpression:old?'#v=:v':'attribute_not_exists(pk)',...(old?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':old.version}}:{})}}]}));if(Math.floor(now()/60000)*60000!==window)return fail('QUOTE_RATE_UNAVAILABLE');return;}catch(e:any){if(e.name==='TransactionCanceledException'&&e.CancellationReasons?.length===1&&e.CancellationReasons[0]?.Code==='ConditionalCheckFailed')continue;throw e;}
 }
 return fail('QUOTE_RATE_UNAVAILABLE');
}
