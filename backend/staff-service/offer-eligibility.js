'use strict';
const {GetCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const TABLE='staging-WizzOfferJourney';
const fail=code=>{throw Object.assign(Error(code),{statusCode:409,status:409});};
const read=async(db,Key)=>(await db.send(new GetCommand({TableName:TABLE,Key,ConsistentRead:true}))).Item;
async function history(db,sub,userId){let cursor,count=0,lastAt=0,uses={};for(let n=0;n<100;n++){
 const r=await db.send(new ScanCommand({TableName:'WizzOrders',ConsistentRead:true,Select:'SPECIFIC_ATTRIBUTES',ExclusiveStartKey:cursor,FilterExpression:'userSub = :sub OR userId = :uid',ExpressionAttributeValues:{':sub':sub,':uid':userId||sub},ProjectionExpression:'orderId,createdAt,discountId,promoCode'}));
 for(const o of r.Items||[]){count++;lastAt=Math.max(lastAt,Date.parse(o.createdAt)||0);for(const key of [o.discountId&&'id:'+o.discountId,o.promoCode&&'code:'+o.promoCode].filter(Boolean))uses[key]=(uses[key]||0)+1;}
 cursor=r.LastEvaluatedKey;if(!cursor)return {count,lastAt,uses};
 }fail('OFFER_HISTORY_UNAVAILABLE');}
async function customerState(db,identity){if(!identity?.sub)return null;const key={pk:'USER#'+identity.sub,sk:'ORDERS'},stored=await read(db,key);let pending;return {key,stored,history:()=>pending ||= history(db,identity.sub,identity.userId),getCount:async()=>stored?.count??(await (pending ||= history(db,identity.sub,identity.userId))).count};}
function putCount(key,stored,count,extra={}){return {Put:{TableName:TABLE,Item:{...key,count,...extra,version:(stored?.version||0)+1},ConditionExpression:stored?'#v=:v':'attribute_not_exists(pk)',...(stored?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':stored.version}}:{})}};}
async function orderOperation(state){if(!state)return null;return putCount(state.key,state.stored,await state.getCount()+1,{lastAt:Date.now()});}
async function eligibility(db,raw,{identity,customer,regionIds=[],branchId,source='platform',preview=false}={}){
 const signedIn=!!identity?.sub,segments=raw.customerSegments||['all'];
 const firstOrder=raw.firstOrderOnly===true||['first-order','first_order'].includes(raw.campaignType);
 const newCustomer=['new-customer','new_customer'].includes(raw.campaignType);
 if(!Array.isArray(segments)||segments.some(s=>!['all','registered','guests','new','returning','vip','inactive'].includes(s)))fail('OFFER_AUDIENCE_UNSUPPORTED');
 if(raw.targetSegments?.length||raw.occasions?.length)fail('OFFER_AUDIENCE_UNSUPPORTED');
 if(raw.customerIds?.length&&(!signedIn||!raw.customerIds.includes(identity.userId)&&!raw.customerIds.includes(identity.sub)))fail('OFFER_NOT_ELIGIBLE');
 const merchants=raw.targetRestaurants?.length?raw.targetRestaurants:raw.allowedBusinessIds?.length?raw.allowedBusinessIds:raw.businessIds?.length?raw.businessIds:raw.businessId?[raw.businessId]:[];
 if(!Array.isArray(merchants)||raw.applicableToAll===false&&!merchants.length&&!raw.targetRegionIds?.length&&!raw.customerIds?.length&&!firstOrder&&!newCustomer&&!segments.some(s=>s!=='all'))fail('OFFER_MERCHANT_UNSUPPORTED');
 if(branchId&&merchants.length&&!merchants.includes(branchId))fail('OFFER_WRONG_MERCHANT');
 const regions=raw.targetRegionIds||[];if(!Array.isArray(regions))fail('OFFER_REGION_UNSUPPORTED');
 if(regions.length&&!regions.some(r=>regionIds.includes(r)))fail('OFFER_WRONG_REGION');
 if(!regions.length&&(raw.targetLocation||raw.target&&!['all','All regions','All Customers'].includes(raw.target)))fail('OFFER_REGION_UNSUPPORTED');
 let count;const orders=async()=>count??=(customer?await customer.getCount():0);
 let audience=!segments.length||segments.includes('all')||segments.includes(signedIn?'registered':'guests');
 if(signedIn&&!audience){for(const s of segments){if(s==='returning'&&await orders()>0)audience=true;
 if(s==='new'){const joined=Date.parse(identity.profile?.createdAt);if(Number.isFinite(joined)&&Date.now()>=joined&&Date.now()-joined<7*86400000)audience=true;}
 if(s==='vip'&&identity.profile?.isVip===true)audience=true;
 if(s==='inactive'&&await orders()>0){const last=customer.stored?.lastAt??(await customer.history()).lastAt;if(last>0&&Date.now()-last>=30*86400000)audience=true;}}
 }
 if(!audience)fail('OFFER_NOT_ELIGIBLE');
 if(newCustomer){const joined=Date.parse(identity?.profile?.createdAt);if(!signedIn||!Number.isFinite(joined)||Date.now()<joined||Date.now()-joined>=7*86400000)fail('OFFER_NOT_ELIGIBLE');}
 if(firstOrder&&(!signedIn||await orders()!==0))fail('OFFER_FIRST_ORDER_ONLY');
 const limit=raw.singleUse?1:raw.perCustomerLimit;
 if(limit!=null&&(!Number.isSafeInteger(limit)||limit<1))fail('OFFER_CUSTOMER_LIMIT_UNSUPPORTED');
 let redemption=null;
 if(signedIn&&(!preview||limit)){const key={pk:'USER#'+identity.sub,sk:'OFFER#'+source+'#'+raw.discountId},stored=await read(db,key);const used=stored?.count??((source==='merchant'?(await customer.history()).uses['id:'+raw.discountId]:(raw.code&&(await customer.history()).uses['code:'+raw.code]))||0);
 if(limit&&used>=limit)fail('OFFER_ALREADY_USED');redemption=putCount(key,stored,used+1);
 }else if(!signedIn&&(limit||firstOrder))fail('OFFER_LOGIN_REQUIRED');
 return {redemption,merchants};
}
async function regionAncestors(db,regionId){const list=[];for(let n=0;regionId&&n<8&&!list.includes(regionId);n++){const r=(await db.send(new GetCommand({TableName:'WizzCentral_Regions',Key:{regionId},ConsistentRead:true}))).Item;if(!r)break;list.push(regionId);regionId=r.parent_id;}return list;}
function catalogItems(catalog){return catalog.lines.map(l=>{const c=catalog.conditions.find(x=>x.ConditionCheck?.Key?.productId===l.productId)?.ConditionCheck;const key=Object.entries(c?.ExpressionAttributeNames||{}).find(([,v])=>v==='categoryId')?.[0];const categoryId=key?c.ExpressionAttributeValues[':'+key.slice(1)]:null;return {itemId:l.productId,categoryId,price:l.unitPrice.minorAmount,quantity:l.quantity};});}
module.exports={TABLE,read,history,customerState,orderOperation,eligibility,regionAncestors,catalogItems,fail};
