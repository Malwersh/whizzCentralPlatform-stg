'use strict';
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('./catalog');
const {versioned,revision,fence,digest}=require('./campaign-version');
const TABLES={PLATFORM:'WizzCentral_Platform_Discounts',MERCHANT:'WhizzMerchants_Discounts'},S='staging-PlatformStaff',B='WhizzMerchants_Businesses',L='staging-AccountDeletion';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{status});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const platformFields=['title','name','description','code','type','discountType','campaignType','value','discountValue','minOrderValue','minOrderAmount','usageLimit','limit','startDate','endDate','validFrom','validTo','status','isActive','autoActivate','target','targetRegionIds','targetLocation','targetRestaurants','targetSegments','occasions','customerSegments','singleUse','stackable','applicableToAll','discountSource','maxDiscount','maxDiscountAmount'];
const merchantFields=['title','description','type','value','applicability','minimum_order_amount','valid_from','valid_to','status','usage_limit','applicable_item_ids','applicable_category_ids','conditional_rule','conditional_parameters'];
const aliases=[['title','name'],['type','discountType'],['value','discountValue'],['minOrderValue','minOrderAmount'],['usageLimit','limit'],['startDate','validFrom'],['endDate','validTo']];
const project=r=>Object.fromEntries(['discountId','businessId','campaignId','id','version','fundingPolicyId','fundingPolicyVersion','createdAt','updatedAt','created_at','updated_at','usage_count','usage','currentUsage',...platformFields,...merchantFields].filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
function values(source,patch,current,now,actorId,discountId){
 if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!(source==='PLATFORM'?platformFields:merchantFields).includes(k)))fail('CAMPAIGN_FIELDS_INVALID');
 const v={...(current||{}),...patch};if(source==='PLATFORM'){
  for(const [a,b]of aliases){if(patch[a]!==undefined&&patch[b]!==undefined&&patch[a]!==patch[b])fail('CAMPAIGN_ALIASES_CONFLICT');if(patch[a]!==undefined)v[b]=patch[a];else if(patch[b]!==undefined)v[a]=patch[b];}
  for(const k of ['type','discountType'])if(v[k]==='fixed_amount'||v[k]==='fixedAmount')v[k]='fixed';
  if(!current)Object.assign(v,{discountId,id:discountId,campaignId:discountId,createdAt:now,createdBy:actorId,usage:0,currentUsage:0,description:v.description||'',customerSegments:v.customerSegments||['all'],targetRegionIds:v.targetRegionIds||[],targetRestaurants:v.targetRestaurants||[],targetSegments:v.targetSegments||[],occasions:v.occasions||[],singleUse:v.singleUse??false,stackable:v.stackable??false,applicableToAll:v.applicableToAll??true,discountSource:v.discountSource||'campaign',status:v.status||'draft',isActive:v.isActive??false,autoActivate:v.autoActivate??false,usageLimit:v.usageLimit??0,limit:v.limit??0,minOrderAmount:v.minOrderAmount??0,minOrderValue:v.minOrderValue??0});
  v.updatedAt=now;
  if(typeof v.code!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(v.code))fail('CAMPAIGN_CODE_INVALID');
  for(const k of ['isActive','autoActivate','singleUse','stackable','applicableToAll'])if(v[k]!==undefined&&typeof v[k]!=='boolean')fail('CAMPAIGN_FIELDS_INVALID');
  for(const k of ['targetRegionIds','targetRestaurants','targetSegments','occasions','customerSegments'])if(v[k]!==undefined&&(!Array.isArray(v[k])||v[k].length>20||v[k].some(x=>!id(x))||new Set(v[k]).size!==v[k].length))fail('CAMPAIGN_TARGET_INVALID');
 }else v.updated_at=now;
 const title=v.title||v.name,type=v.type,value=v.value,start=source==='PLATFORM'?v.validFrom:v.valid_from,end=source==='PLATFORM'?v.validTo:v.valid_to,min=source==='PLATFORM'?v.minOrderAmount:v.minimum_order_amount;
 if(typeof title!=='string'||!title.trim()||title.length>150||typeof(v.description??'')!=='string'||(v.description||'').length>2000)fail('CAMPAIGN_FIELDS_INVALID');
 if(!['percentage','fixed','fixedAmount','freeDelivery',...(source==='MERCHANT'?['conditional','buyXGetY']:[])].includes(type)||!Number.isFinite(value)||value<0||(type==='percentage'&&(value<=0||value>100))||(['fixed','fixedAmount'].includes(type)&&(!Number.isSafeInteger(value)||value<=0)))fail('CAMPAIGN_VALUE_INVALID');
 if(min!==undefined&&(!Number.isFinite(min)||min<0||min>1000000000))fail('CAMPAIGN_VALUE_INVALID');
 if(!['active','inactive','paused','draft','scheduled','expired'].includes(v.status))fail('CAMPAIGN_STATE_INVALID');
 const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===x.slice(0,10);
 if(!date(start)||!date(end)||Date.parse(start)>=Date.parse(end))fail('CAMPAIGN_PERIOD_INVALID');
 const limit=source==='PLATFORM'?v.usageLimit:v.usage_limit;if(limit!=null&&(!Number.isSafeInteger(limit)||limit<0))fail('CAMPAIGN_LIMIT_INVALID');
 return v;
}
async function route(ctx,actor,method,input){
 if(!allowed(actor,'promotions.read'))fail('PERMISSION_REQUIRED',403);
 const {source,discountId}=input||{},table=TABLES[source];if(!table||!id(discountId))fail('CAMPAIGN_SCOPE_INVALID');
 const get=async(t,k)=>(await ctx.db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;
 const previous=method==='POST'&&uuid(input.requestId)?await get(S,{pk:'CAMPAIGN_REQUEST#'+input.requestId,sk:'META'}):null;
 if(previous&&(previous.actorId!==actor.employeeId||previous.fingerprint!==digest({actorId:actor.employeeId,...input})))fail('REQUEST_ID_CONFLICT',409);
 const current=await get(table,{discountId});
 const guards=[ctx.guard(actor)];
 async function scope(row){
  if(source==='MERCHANT'){
   if(!id(row?.businessId))fail('CAMPAIGN_UNAVAILABLE',404);const branch=await get(B,{businessId:row.businessId});if(!branch||!(actor.scope?.allRegions===true||typeof branch.regionId==='string'&&allowed(actor,'promotions.read',branch.regionId))||branch.deletionRequestId!=null||branch.isDeleted===true||branch.deletedAt!=null)fail('CAMPAIGN_UNAVAILABLE',404);
   guards.push({ConditionCheck:{TableName:B,Key:{businessId:branch.businessId},...fence(branch)}},{ConditionCheck:{TableName:L,Key:{pk:'BUSINESS_LIFECYCLE#MERCHANT#'+branch.businessId,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}},{ConditionCheck:{TableName:L,Key:{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+(branch.ownerId||branch.cognitoUserId),sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});
  }else{
   const regions=row?.targetRegionIds||[];if(actor.scope?.allRegions!==true&&(!regions.length||regions.some(r=>!allowed(actor,'promotions.read',r))))fail('REGION_SCOPE_REQUIRED',403);
  }
 }
 if(current)await scope(current);else if(previous?.scope)await scope(previous.scope);else if(source==='MERCHANT')fail('CAMPAIGN_UNAVAILABLE',404);
 async function write(ops){try{await ctx.db.send(new TransactWriteCommand({TransactItems:[...guards,...ops]}));}catch(e){if(e.name==='TransactionCanceledException')fail('VERSION_OR_STATE_CONFLICT',409);throw e;}}
 if(method==='GET'){
  if(!current)fail('CAMPAIGN_UNAVAILABLE',404);await write([{ConditionCheck:{TableName:table,Key:{discountId},...fence(current)}}]);return {campaign:project(current),revision:revision(current)};
 }
 if(method!=='POST'||!['CREATE','UPDATE','DELETE','ADOPT'].includes(input.action))fail('INVALID_CAMPAIGN_ACTION');
 if(Object.keys(input).some(k=>!['source','discountId','action','requestId','baseRevision','values'].includes(k))||!uuid(input.requestId))fail('INVALID_CAMPAIGN_REQUEST');
 if(!allowed(actor,input.action==='CREATE'?'promotions.create':'promotions.edit'))fail('PERMISSION_REQUIRED',403);
 if(!ctx.enrolled)fail('ENROLLMENT_REQUIRED',403);
 const markerKey={pk:'CAMPAIGN_REQUEST#'+input.requestId,sk:'META'},fingerprint=digest({actorId:actor.employeeId,...input});
 if(previous){if(previous.actorId!==actor.employeeId||previous.fingerprint!==fingerprint)fail('REQUEST_ID_CONFLICT',409);await write([]);return {...previous.receipt,replayed:true};}
 if(input.action==='CREATE'&&(current||source!=='PLATFORM'))fail('CAMPAIGN_ALREADY_EXISTS',409);
 if(input.action!=='CREATE'&&(!current||input.baseRevision!==revision(current)))fail('VERSION_OR_STATE_CONFLICT',409);
 if(current&&(current.legalHold===true||current.retentionHold===true))fail('CAMPAIGN_RETENTION_HOLD',409);
 const now=ctx.now?.()||new Date().toISOString();let next=null;
 if(input.action!=='DELETE'){
  next=input.action==='ADOPT'?versioned(current,current):versioned(current,values(source,input.values,current,now,actor.employeeId,discountId));
  if(source==='PLATFORM'){
   await scope(next);
   for(const regionId of next.targetRegionIds||[]){const region=await get('WizzCentral_Regions',{regionId});if(!region||region.isActive===false||region.is_active===false||region.deletedAt||region.status==='inactive')fail('CAMPAIGN_REGION_UNAVAILABLE',409);guards.push({ConditionCheck:{TableName:'WizzCentral_Regions',Key:{regionId},...fence(region)}});}
  }
 }
 const receipt={success:true,discountId,campaignId:discountId,version:next?.version||current.version||null,...(input.action==='DELETE'?{deleted:true}:{})};
 const op=input.action==='DELETE'?{Delete:{TableName:table,Key:{discountId},...fence(current)}}:{Put:{TableName:table,Item:next,...(current?fence(current):{ConditionExpression:'attribute_not_exists(discountId)'})}};
 const summary=row=>row?{discountId:row.discountId,version:row.version??null,termsDigest:digest(row),fundingPolicyId:row.fundingPolicyId??null,fundingPolicyVersion:row.fundingPolicyVersion??null}:null;
 await write([op,{Put:{TableName:S,Item:{...markerKey,actorId:actor.employeeId,fingerprint,receipt,scope:source==='MERCHANT'?{businessId:current.businessId}:{targetRegionIds:(next||current).targetRegionIds||[]},createdAt:now},ConditionExpression:'attribute_not_exists(pk)'}},ctx.audit(actor.employeeId,'CAMPAIGN_'+input.action,{source,...summary(current)},{source,...summary(next)},input.requestId)]);
 return receipt;
}
module.exports={route,values};
