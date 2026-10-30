'use strict';
const {GetCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const journey=require('./offer-eligibility');
const {randomUUID}=require('crypto');
const {allowed}=require('./catalog');
const KEY={pk:'HOME_SLIDESHOW',sk:'CURRENT'};
let userVerifier;
const BUCKET='staging-wizz-home-slideshow-699561669180';
const TABLES={merchant:'WhizzMerchants_Businesses',campaign:'WizzCentral_Platform_Discounts',category:'WhizzMerchants_Categories',region:'WizzCentral_Regions',discount:'WhizzMerchants_Discounts'};
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const id=v=>typeof v==='string'&&/^[\w-]{1,150}$/.test(v);
function inScope(actor,slide){return actor.scope?.allRegions===true||(slide.regionIds.length>0&&slide.regionIds.every(r=>actor.scope?.regionIds?.includes(r)));}
function validate(s){
 if(!s||typeof s.title!=='string'||!s.title.trim()||s.title.length>100)throw fail('Enter a slide title (up to 100 characters).');
 if(!id(s.id)||!['draft','published','paused'].includes(s.status))throw fail('Invalid slide or status.');
 if(!['all','registered','guests'].includes(s.audience))throw fail('Choose a valid audience.');
 if(!Array.isArray(s.regionIds)||s.regionIds.length>50||s.regionIds.some(r=>!id(r)))throw fail('Choose valid regions.');
 if(!Number.isInteger(s.displayOrder)||s.displayOrder<0||s.displayOrder>999)throw fail('Display order must be between 0 and 999.');
 if(!['merchant','campaign','category','discount','platform'].includes(s.action?.type)||!id(s.action?.id))throw fail('Choose a tap destination.');
 if(s.action.type==='category'&&!id(s.action.merchantId))throw fail('Choose the category merchant.');
 const date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
 if(!date(s.startAt)||!date(s.endAt)||Date.parse(s.endAt)<=Date.parse(s.startAt))throw fail('End time must be after the start time.');
 if(typeof s.imageKey!=='string'||!/^home-slideshow\/[\w-]+\/[\w-]+\.(?:jpg|gif)$/.test(s.imageKey))throw fail('Upload an image first.');
 return {id:s.id,title:s.title.trim(),status:s.status,audience:s.audience,regionIds:[...new Set(s.regionIds)],displayOrder:s.displayOrder,startAt:s.startAt,endAt:s.endAt,imageKey:s.imageKey,action:{type:s.action.type,id:s.action.id,...(s.action.type==='category'?{merchantId:s.action.merchantId}:{})}};
}
function eligible(s,{now=Date.now(),signedIn=false,regionIds=[]}={}){
 return s.status==='published'&&Date.parse(s.startAt)<=now&&now<Date.parse(s.endAt)&&
  (s.audience==='all'||s.audience===(signedIn?'registered':'guests'))&&
  (!s.regionIds.length||s.regionIds.some(id=>regionIds.includes(id)));
}
const get=async(ctx,TableName,Key)=>(await ctx.db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;
async function state(ctx){return await get(ctx,ctx.table,KEY)||{...KEY,version:0,slides:[]};}
async function scan(ctx,TableName){let rows=[],cursor;for(let n=0;n<20;n++){const r=await ctx.db.send(new ScanCommand({TableName,ExclusiveStartKey:cursor}));rows.push(...(r.Items||[]));cursor=r.LastEvaluatedKey;if(!cursor)return rows;}throw fail('Destination list is too large. Contact support.',503);}
function validImageMetadata(key,head){
 const gif=key.endsWith('.gif');
 return head.ContentType===(gif?'image/gif':'image/jpeg')&&Number.isFinite(head.ContentLength)&&head.ContentLength>=(gif?35:100)&&head.ContentLength<=(gif?3*1024*1024:600000);
}
function assets(ctx){
 if(ctx.assets)return ctx.assets;
 const {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand}=require('@aws-sdk/client-s3');
 const {getSignedUrl}=require('@aws-sdk/s3-request-presigner');const client=new S3Client({});
 return {put:(Key,Body)=>client.send(new PutObjectCommand({Bucket:BUCKET,Key,Body,ContentType:Key.endsWith('.gif')?'image/gif':'image/jpeg',CacheControl:'private,max-age=900',ServerSideEncryption:'AES256'})),head:Key=>client.send(new HeadObjectCommand({Bucket:BUCKET,Key})),url:Key=>getSignedUrl(client,new GetObjectCommand({Bucket:BUCKET,Key}),{expiresIn:3600})};
}


function offerInfo(row){return {...require('./offers').normalize(row),status:row.isActive===false?'inactive':row.status||(row.isActive===true?'active':'inactive')};}
function offerLive(row){
 const engine=require('./discount-engine');try{const d=row.businessId?engine.normalizeDiscount(row):engine.normalizePlatformPromo(row);if(!(row.businessId?engine.validateDiscount(d,Number.MAX_SAFE_INTEGER):engine.validatePlatformPromo(d,Number.MAX_SAFE_INTEGER)).valid)return false;}catch{return false;}
 const o=offerInfo(row),now=Date.now(),limit=row.usageLimit??row.usage_limit??null,used=row.usageCount??row.usage_count??row.usage??row.currentUsage??0;
 return row.isActive!==false&&o.status==='active'&&(!o.startAt||(Number.isFinite(Date.parse(o.startAt))&&Date.parse(o.startAt)<=now))&&(!o.endAt||(Number.isFinite(Date.parse(o.endAt))&&now<Date.parse(o.endAt)))&&(!limit||used<limit);
}
async function target(ctx,s){
 const key=s.action.type==='merchant'?{businessId:s.action.id}:['campaign','discount','platform'].includes(s.action.type)?{discountId:s.action.id}:{categoryId:s.action.id};
 const row=await get(ctx,s.action.type==='platform'?TABLES.campaign:TABLES[s.action.type],key);
 if(!row||row.benefit||row.isDeleted||row.deletedAt)throw fail('Selected destination is no longer available.');
 if(s.action.type==='platform'&&row.discountSource==='campaign')throw fail('Choose this offer from Campaign / promo.');
 if(s.action.type==='category'&&(row.businessId||row.business_id)!==s.action.merchantId)throw fail('Category does not belong to this merchant.');
 return row;
}
async function route(ctx,actor,method,path,input){
 if(!allowed(actor,'promotions.read'))throw fail('You do not have permission to view promotions.',403);
 const current=await state(ctx);
 if(method==='GET'&&path==='/staff/slideshow'){
  const slides=await Promise.all(current.slides.filter(s=>inScope(actor,s)).map(async s=>({...s,imageUrl:await assets(ctx).url(s.imageKey)})));
  return {version:current.version,slides,canCreate:allowed(actor,'promotions.create'),canEdit:allowed(actor,'promotions.edit'),canPublish:allowed(actor,'promotions.approve'),allRegions:actor.scope?.allRegions===true};
 }
 if(method==='GET'&&path==='/staff/slideshow/report')return {slides:await Promise.all(current.slides.filter(s=>inScope(actor,s)).map(async s=>({slideId:s.id,title:s.title,...(await journey.read(ctx.db,{pk:'STATS#'+s.id,sk:'TOTAL'})||{})}))),note:'Views and taps are estimates. Orders and savings are recorded with successful order placement; cancellations are not subtracted.'};
 if(method==='GET'&&path==='/staff/slideshow/options'){
  const [merchants,campaigns,categories,regions,discounts]=await Promise.all(Object.values(TABLES).map(t=>scan(ctx,t)));
  const visible=merchants.filter(m=>!m.isDeleted&&!m.deletedAt&&(actor.scope?.allRegions===true||actor.scope?.regionIds?.includes(m.regionId)));
  const ids=new Set(visible.map(m=>m.businessId));
  return {platformDiscounts:campaigns.filter(c=>!c.benefit&&c.discountSource!=='campaign'&&!c.isDeleted&&!c.deletedAt).map(c=>({...offerInfo(c),id:c.discountId,label:(c.title||c.name||c.code||c.discountId)+(c.code?' ('+c.code+')':'')})),discounts:discounts.filter(d=>ids.has(d.businessId)&&!d.isDeleted&&!d.deletedAt).map(d=>({...offerInfo(d),id:d.discountId,merchantId:d.businessId,label:(d.title||d.name||d.discountId)+' — '+(visible.find(m=>m.businessId===d.businessId)?.businessName||d.businessId)})),merchants:visible.map(m=>({id:m.businessId,label:m.businessName||m.businessNameArabic||m.name||m.businessId})),campaigns:campaigns.filter(c=>!c.benefit&&c.discountSource==='campaign'&&!c.isDeleted).map(c=>({...offerInfo(c),id:c.discountId,label:(c.title||c.name||c.code)+' ('+c.code+')'})),categories:categories.filter(c=>ids.has(c.businessId||c.business_id)&&c.isActive!==false&&c.is_active!==false).map(c=>({id:c.categoryId,merchantId:c.businessId||c.business_id,label:c.name_ar||c.categoryName||c.category_name||c.name||c.categoryId})),regions:regions.filter(r=>actor.scope?.allRegions===true||actor.scope?.regionIds?.includes(r.regionId)).map(r=>({id:r.regionId,parentId:r.parent_id,label:[r.name_ar,r.name_en||r.name].filter(Boolean).join(' / ')||r.regionId}))};
 }
 if(method==='POST'&&path==='/staff/slideshow/upload'){
  if(!allowed(actor,'promotions.create')&&!allowed(actor,'promotions.edit'))throw fail('You do not have permission to upload images.',403);
  const gif=input.contentType==='image/gif'||(typeof input.image==='string'&&/^(R0lGODdh|R0lGODlh)/.test(input.image)),limit=gif?3*1024*1024:600000;
  if(input.contentType&&!['image/jpeg','image/gif'].includes(input.contentType))throw fail('Upload a JPEG or GIF image.');
  if(typeof input.image!=='string'||input.image.length>Math.ceil(limit/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.image))throw fail('Upload a JPEG smaller than 600 KB or GIF smaller than 3 MB.');
  const body=Buffer.from(input.image,'base64');
  if(body.length>limit)throw fail('Image is too large.');
  if(gif){
   if(body.length<35||!['GIF87a','GIF89a'].includes(body.toString('ascii',0,6))||body.at(-1)!==0x3b)throw fail('Invalid GIF image.');
   const width=body.readUInt16LE(6),height=body.readUInt16LE(8);
   if(!width||!height||width*height>40000000)throw fail('Invalid GIF dimensions.');
  }else if(body.length<100||body[0]!==255||body[1]!==216||body[2]!==255||body.at(-2)!==255||body.at(-1)!==217)throw fail('Invalid JPEG image.');
  const imageKey=`home-slideshow/${actor.employeeId}/${randomUUID()}.${gif?'gif':'jpg'}`;
  await assets(ctx).put(imageKey,body);return {imageKey,imageUrl:await assets(ctx).url(imageKey)};
 }
 if(method!=='POST'||!['/staff/slideshow/save','/staff/slideshow/status'].includes(path))throw fail('NOT_FOUND',404);
 const statusOnly=path.endsWith('/status'),previous=statusOnly?current.slides.find(x=>x.id===input.id):null;
 if(statusOnly&&(!previous||!allowed(actor,'promotions.approve')))throw fail('Publishing or pausing requires promotion approval permission.',403);
 const s=validate(statusOnly?{...previous,status:input.status}:input.slide),before=current.slides.find(x=>x.id===s.id);
 if(!statusOnly&&!allowed(actor,before?'promotions.edit':'promotions.create'))throw fail('You do not have permission to save this slide.',403);
 if(!inScope(actor,s)||(before&&!inScope(actor,before)))throw fail('Choose regions within your assigned scope.',403);
 if((s.status==='published'||before?.status==='published')&&!allowed(actor,'promotions.approve'))throw fail('Publishing or changing a published slide requires promotion approval permission.',403);
 if(input.baseVersion!==current.version)throw fail('Slides changed in another window. Refresh before saving.',409);
 if(!before&&current.slides.length>=20)throw fail('You can manage up to 20 slides. Reuse an existing slide.');
 if(s.imageKey!==before?.imageKey&&!s.imageKey.startsWith(`home-slideshow/${actor.employeeId}/`))throw fail('Upload an image using your own account.',403);
 const head=await assets(ctx).head(s.imageKey);if(!validImageMetadata(s.imageKey,head))throw fail('Uploaded image is unavailable.');
 const destination=await target(ctx,s);

 if(['campaign','platform'].includes(s.action.type)&&!require('./offers').inScope(actor,destination,[]))throw fail('Offer is outside your assigned region scope.',403);

 if(s.action.type==='discount'){const merchant=await get(ctx,TABLES.merchant,{businessId:destination.businessId});if(!merchant||(actor.scope?.allRegions!==true&&!actor.scope?.regionIds?.includes(merchant.regionId)))throw fail('Merchant is outside your region scope.',403);}
 if(s.action.type==='category'){const merchant=await get(ctx,TABLES.merchant,{businessId:s.action.merchantId});if(!merchant||(actor.scope?.allRegions!==true&&!actor.scope?.regionIds?.includes(merchant.regionId)))throw fail('Merchant is outside your region scope.',403);}
 if(s.action.type==='merchant'&&actor.scope?.allRegions!==true&&!actor.scope?.regionIds?.includes(destination.regionId))throw fail('Merchant is outside your region scope.',403);
 for(const regionId of s.regionIds)if(!await get(ctx,TABLES.region,{regionId}))throw fail('A selected region no longer exists.');
 const now=new Date().toISOString();s.updatedAt=now;s.updatedBy=actor.employeeId;
 const next={...KEY,version:current.version+1,slides:[...current.slides.filter(x=>x.id!==s.id),s].sort((a,b)=>a.displayOrder-b.displayOrder||a.id.localeCompare(b.id)),updatedAt:now};
 const put={TableName:ctx.table,Item:next,ConditionExpression:current.version?'#v=:v':'attribute_not_exists(pk)',...(current.version?{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}:{})};
 try{await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),{Put:put},ctx.audit(actor.employeeId,'HOME_SLIDE_SAVED',before||null,s,randomUUID())]}));}catch(e){if(e.name==='TransactionCanceledException')throw fail('Slides changed. Refresh before saving.',409);throw e;}
 return {saved:true,version:next.version};
}
async function publicFeed(ctx,event){
 let signedIn=false,identity=null;const auth=event.headers?.Authorization||event.headers?.authorization;
 if(auth){try{const {CognitoJwtVerifier}=require('aws-jwt-verify');userVerifier ||= CognitoJwtVerifier.create({userPoolId:'us-east-1_TpyyrVkEE',clientId:'4a9e8o3em311eq2rgckp0pd2s9',tokenUse:'access'});const claims=await userVerifier.verify(auth.replace(/^Bearer\s+/i,''));signedIn=true;identity={sub:claims.sub,userId:event.queryStringParameters?.userId||claims.sub};const profile=await get(ctx,'WizzUser_users_staging',{userId:identity.userId});if(!profile||profile.isActive===false||profile.deletionRequestId||!(profile.userId===claims.sub||profile.cognitoSub===claims.sub||profile.cognitoUsername===claims.username))throw fail('UNAUTHORIZED',401);identity.profile=profile;}catch{throw fail('UNAUTHORIZED',401);}}
 const ancestors=[];let regionId=event.queryStringParameters?.regionId;
 if(regionId&&!id(regionId))throw fail('Invalid region.');
 for(let n=0;regionId&&n<8&&!ancestors.includes(regionId);n++){const r=await get(ctx,TABLES.region,{regionId});if(!r)break;ancestors.push(regionId);regionId=r.parent_id;}
 const customer=await journey.customerState(ctx.db,identity);
 // Campaign discovery reads campaign records directly, without requiring slideshow placement.
 const campaignId=event.queryStringParameters?.campaignId;
 const standalone=event.queryStringParameters?.campaigns==='1'||campaignId!==undefined;
 if(campaignId!==undefined&&!id(campaignId))throw fail('Invalid campaign.');
 const rows=standalone?(campaignId?[await get(ctx,TABLES.campaign,{discountId:campaignId})]:(await scan(ctx,TABLES.campaign))):[];
 const current=standalone?{version:1,slides:rows.filter(r=>r&&!r.benefit&&!r.isDeleted&&!r.deletedAt&&offerLive(r)).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).map(r=>{
  const info=offerInfo(r);return {id:r.discountId,title:info.title,imageKey:r.imageKey||'',updatedAt:r.updatedAt||String(r.version||''),status:'published',audience:'all',regionIds:[],displayOrder:0,startAt:info.startAt||'1970-01-01T00:00:00.000Z',endAt:info.endAt||'9999-01-01T00:00:00.000Z',action:{type:r.discountSource==='campaign'?'campaign':'platform',id:r.discountId}};
 })}:await state(ctx),slides=[];
 for(const s of current.slides.filter(s=>eligible(s,{signedIn,regionIds:ancestors})).sort((a,b)=>a.displayOrder-b.displayOrder||a.id.localeCompare(b.id))){
  let row;try{row=await target(ctx,s);}catch(e){if(e.status===400)continue;throw e;}
  if(['campaign','discount','platform'].includes(s.action.type)&&!offerLive(row))continue;
  if(s.action.type==='discount'){const merchant=await get(ctx,TABLES.merchant,{businessId:row.businessId});if(!merchant||merchant.isDeleted||merchant.deletedAt||merchant.isActive===false||merchant.platformSuspended===true)continue;}
  let merchants=[];
  if(['platform','campaign','discount'].includes(s.action.type)){
   try{await journey.eligibility(ctx.db,row,{identity,customer,regionIds:ancestors,source:s.action.type==='discount'?'merchant':'platform',preview:true});}catch(e){if(e.status===409)continue;throw e;}
   const merchantIds=row.targetRestaurants?.length?row.targetRestaurants:row.allowedBusinessIds?.length?row.allowedBusinessIds:row.businessIds?.length?row.businessIds:row.businessId?[row.businessId]:[];
   for(const businessId of merchantIds){const m=await get(ctx,TABLES.merchant,{businessId});if(m&&!m.isDeleted&&!m.deletedAt&&m.isActive!==false&&!m.platformSuspended)merchants.push({id:businessId,name:m.businessName||m.businessNameArabic||m.name||businessId});}
   if(merchantIds.length&&!merchants.length)continue;
  }
  if(s.action.type==='merchant'&&(row.isActive===false||row.platformSuspended===true))continue;
  if(s.action.type==='category'&&(row.isActive===false||row.is_active===false))continue;
  slides.push({id:s.id,title:s.title,imageUrl:s.imageKey?await assets(ctx).url(s.imageKey):'',...(standalone?{standalone:true}:{}),imageVersion:s.updatedAt,endAt:['campaign','discount','platform'].includes(s.action.type)&&offerInfo(row).endAt?new Date(Math.min(Date.parse(s.endAt),Date.parse(offerInfo(row).endAt))).toISOString():s.endAt,action:{...(['platform','campaign','discount'].includes(s.action.type)?{type:'campaign',id:row.discountId,offerSource:s.action.type==='discount'?'merchant':'platform',merchants,allMerchants:!row.targetRestaurants?.length&&!row.allowedBusinessIds?.length&&!row.businessIds?.length&&!row.businessId}:s.action),...(['campaign','platform','discount'].includes(s.action.type)?{code:row.code,description:row.description||''}:{})}});
 }
 if(event.path==='/staff/public/home-offer'){
  const selected=slides.find(s=>s.id===(campaignId||event.queryStringParameters?.slideId));if(!selected)throw fail('Offer unavailable for this account or location.',404);
  const original=current.slides.find(s=>s.id===selected.id),offer=await target(ctx,original);
  if(!['campaign','platform','discount'].includes(original.action.type))throw fail('This slide is not an offer.',400);
  const all=selected.action.allMerchants;
  const merchants=all?(await scan(ctx,TABLES.merchant)).filter(m=>!m.isDeleted&&!m.deletedAt&&m.isActive===true&&!m.platformSuspended&&(!m.regionId||ancestors.includes(m.regionId))).map(m=>({id:m.businessId,name:m.businessName||m.businessNameArabic||m.name||m.businessId})):selected.action.merchants;
  const merchantId=event.queryStringParameters?.merchantId;
  if(merchantId&&!merchants.some(m=>m.id===merchantId))throw fail('Merchant unavailable for this offer.',404);
  let products=[];
  if(merchantId){const categories=new Set((await scan(ctx,TABLES.category)).filter(c=>(!c.businessId||c.businessId===merchantId)&&[undefined,true].includes(c.isActive)&&[undefined,true].includes(c.is_active)).map(c=>c.categoryId));products=(await scan(ctx,'WhizzMerchants_Products')).filter(p=>p.businessId===merchantId&&p.isAvailable===true&&categories.has(p.categoryId)&&
   (offer.applicability!=='specificItems'||offer.applicable_item_ids?.includes(p.productId))&&
   (offer.applicability!=='specificCategories'||offer.applicable_category_ids?.includes(p.categoryId))).map(p=>({id:p.productId,name:p.name_ar||p.name||p.productName||p.productId,price:p.price,imageUrl:p.imageUrl||p.image||'',categoryId:p.categoryId}));}
  return {slide:selected,offer:{id:offer.discountId,source:selected.action.offerSource,title:offer.title||offer.name||selected.title,description:offer.description||'',imageUrl:offer.imageKey?await assets(ctx).url(offer.imageKey):selected.imageUrl,code:offer.code||null,type:offer.type||offer.discountType,value:offer.value??offer.discountValue,minimumOrder:offer.minimumOrderAmount??offer.minimum_order_amount??offer.minOrderAmount??offer.minOrderValue??0,maximumSavings:offer.maxDiscountAmount??offer.maxDiscount??null,firstOrderOnly:offer.firstOrderOnly===true||['first-order','first_order'].includes(offer.campaignType),conditions:(offer.customerSegments||[]).filter(s=>s!=='all').map(s=>({new:'للعملاء المسجلين خلال آخر ٧ أيام',returning:'للعملاء الذين سبق لهم الطلب',vip:'لعملاء VIP المعتمدين',inactive:'للعملاء غير النشطين منذ ٣٠ يوماً',registered:'للحسابات المسجلة',guests:'للضيوف'}[s]||s)).concat(['new-customer','new_customer'].includes(offer.campaignType)?['للعملاء المسجلين خلال آخر ٧ أيام']:[]),singleUse:!!offer.singleUse,perCustomerLimit:offer.singleUse?1:offer.perCustomerLimit??null,applicability:offer.applicability||'allItems',endAt:selected.endAt},merchants,products};
 }
 if(event.path==='/staff/public/slideshow-events'){
  const body=typeof event.body==='string'?JSON.parse(event.body):event.body;
  if(!body||!['view','tap'].includes(body.type)||!id(body.sessionId)||!slides.some(s=>s.id===body.slideId))throw fail('Invalid slide event.');
  const day=new Date().toISOString().slice(0,10),ttl=Math.floor(Date.now()/1000)+7*86400;
  try{await ctx.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:journey.TABLE,Item:{pk:'EVENT#'+body.sessionId,sk:day+'#'+body.slideId+'#'+body.type,ttl},ConditionExpression:'attribute_not_exists(pk)'}},{Update:{TableName:journey.TABLE,Key:{pk:'STATS#'+body.slideId,sk:'TOTAL'},UpdateExpression:'ADD #metric :one',ExpressionAttributeNames:{'#metric':body.type==='view'?'views':'taps'},ExpressionAttributeValues:{':one':1}}}]}));}catch(e){if(e.name!=='TransactionCanceledException')throw e;}
  return {recorded:true};
 }
 return standalone?{campaigns:slides}:{version:current.version,slides};
}
module.exports={route,publicFeed,validate,eligible,KEY,assets,validImageMetadata};
