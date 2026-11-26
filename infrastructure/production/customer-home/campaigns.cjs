'use strict';

const {GetCommand, QueryCommand, ScanCommand} = require('@aws-sdk/lib-dynamodb');
const {normalize} = require('../../../backend/staff-service/offers');
const {normalizePlatformPromo, validatePlatformPromo, normalizeDiscount, validateDiscount} =
  require('../../../backend/staff-service/discount-engine');
const {enrich: enrichScene} = require('../../../backend/staff-service/promotion-scenes');
const {campaignImageKey} = require('./media.cjs');
const eligibility = () => require('./offer-eligibility.cjs');

const campaignTable = 'wizz-production-PlatformDiscounts';
const discountTable = 'wizz-production-MerchantDiscounts';
const missing = () => Object.assign(Error('CAMPAIGN_UNAVAILABLE'),{status:404});
const get = async (db, TableName, Key) =>
  (await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;

async function pages(db, Command, request, limit=20) {
  const rows=[];
  let cursor;
  for (let page=0;page<limit;page++) {
    const result=await db.send(new Command({...request,ExclusiveStartKey:cursor}));
    rows.push(...(result.Items ?? []));
    cursor=result.LastEvaluatedKey;
    if (!cursor) return rows;
  }
  throw Object.assign(Error('CAMPAIGN_RESULTS_LIMIT'),{status:503});
}

const conditionLabels={new:'للعملاء المسجلين خلال آخر ٧ أيام',returning:'للعملاء الذين سبق لهم الطلب',
  vip:'لعملاء VIP المعتمدين',inactive:'للعملاء غير النشطين منذ ٣٠ يومًا',
  registered:'للحسابات المسجلة',guests:'للضيوف'};
const merchantCard = row => ({id:row.businessId,name:row.businessName||row.business_name||row.name||row.businessId});
const visibleMerchant = (ctx, row, regions) => ctx.selectableMerchant(row) &&
  (!row.regionId || regions.includes(row.regionId));

function available(row, offer, now, merchantOffer) {
  if (!row || row.benefit || row.isDeleted || row.deletedAt || row.isActive===false ||
      offer.status!=='active' || offer.unsupported || !['percentage','fixed'].includes(offer.type) ||
      !(Date.parse(offer.startAt)<=now && Date.parse(offer.endAt)>now) ||
      (offer.usageLimit>0 && offer.usage>=offer.usageLimit)) return false;
  try {
    return merchantOffer ? validateDiscount(normalizeDiscount(row),Number.MAX_SAFE_INTEGER).valid
      : validatePlatformPromo(normalizePlatformPromo(row),Number.MAX_SAFE_INTEGER).valid;
  } catch { return false; }
}

async function browse(ctx, query, scope, identity, journey=eligibility(), { headerSettings, factsOnly = false, summaryOnly = false } = {}) {
  const {campaignId, merchantId}=query;
  const merchantOffer=query.offerSource==='merchant';
  const source=merchantOffer?'merchant':'platform';
  const table=merchantOffer?discountTable:campaignTable;
  const rows=campaignId
    ? [await get(ctx.db,table,{discountId:campaignId})]
    : await pages(ctx.db,ScanCommand,{TableName:table,Limit:100,ConsistentRead:true});
  const customer=identity ? await journey.customerState(ctx.db,identity) : null;
  const merchantReads = new Map();
  const sceneContext = { db: ctx.db, promotionMenuTable: 'wizz-production-MerchantPlatform' };
  const readMerchant = id => {
    if (!merchantReads.has(id)) merchantReads.set(id,get(ctx.db,ctx.homeTables.merchants,{businessId:id}));
    return merchantReads.get(id);
  };
  const campaignRows=[];
  const facts = { merchantIds: new Set(), allMerchants: false, expiresAt: scope.now + 60000 };
  for (const row of rows.filter(Boolean).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))) {
    if (merchantOffer && !row.businessId) continue;
    const offer=normalize(row);
    if (!available(row,offer,scope.now,merchantOffer)) continue;
    let targets;
    try {
      targets=(await journey.eligibility(ctx.db,row,{identity,customer,regionIds:scope.regionIds,
        branchId:merchantId,source,preview:true})).merchants;
    } catch (error) {
      if (error.status===409 || error.statusCode===409) continue;
      throw error;
    }
    const branches = (await Promise.all(targets.map(readMerchant)))
      .filter(row => visibleMerchant(ctx, row, scope.regionIds) && (!headerSettings || row.regionId));
    const merchants = branches.map(merchantCard);
    if (headerSettings && merchantOffer && !merchants.length) continue;
    if (targets.length && !merchants.length) continue;
    if (factsOnly) {
      if (merchantOffer && !merchants.length) continue;
      for (const merchant of merchants) facts.merchantIds.add(merchant.id);
      facts.allMerchants ||= !merchantOffer && targets.length === 0;
      facts.expiresAt = Math.min(facts.expiresAt, Date.parse(offer.endAt));
      continue;
    }
    const imageUrl=campaignImageKey(row.imageKey) ? await ctx.assets.url(row.imageKey) : '';
    const slide={id:offer.id,title:offer.title,imageUrl,imageVersion:row.imageKey||String(row.version??''),
      standalone:true,endAt:offer.endAt,action:{type:'campaign',id:offer.id,offerSource:source,
        code:offer.code,description:offer.description,offerType:row.type,offerValue:offer.value,
        merchants,allMerchants:targets.length===0}};
    if (headerSettings && merchantOffer) {
      const branch = branches[0];
      const scene = await enrichScene(sceneContext, { ...merchants[0],
        logoUrl: branch.businessPhotoUrl || branch.business_photo_url || branch.logoUrl,
      }, { applicability: offer.applicability, applicable_item_ids: offer.itemIds,
        applicable_category_ids: offer.categoryIds }, headerSettings);
      if (!scene) continue;
      slide.scene = scene;
    }
    campaignRows.push({row,offer,slide,merchants});
    if (campaignRows.length>=100) break;
  }
  if (factsOnly) return { ...facts, merchantIds: [...facts.merchantIds] };
  if (!campaignId || headerSettings || summaryOnly) return {campaigns:campaignRows.map(entry=>entry.slide)};
  const selected=campaignRows[0];
  if (!selected) throw missing();
  const {row,offer,slide}=selected;
  let merchants=selected.merchants;
  if (slide.action.allMerchants) {
    const all=merchantId?[await readMerchant(merchantId)]:
      await pages(ctx.db,ScanCommand,{TableName:ctx.homeTables.merchants,Limit:100,Select:'SPECIFIC_ATTRIBUTES',
        ProjectionExpression:'businessId,businessName,business_name,#name,regionId,isActive,isDeleted,deletedAt,platformSuspended,deletionRequestId,#status',
        ExpressionAttributeNames:{'#name':'name','#status':'status'}});
    merchants=all.filter(branch=>visibleMerchant(ctx,branch,scope.regionIds)).map(merchantCard);
  }
  let products=[];
  if (merchantId) {
    if (!merchants.some(merchant=>merchant.id===merchantId)) throw missing();
    const rows=await pages(ctx.db,QueryCommand,{TableName:ctx.homeTables.products,IndexName:'BusinessIdIndex',
      KeyConditionExpression:'businessId=:business',ExpressionAttributeValues:{':business':merchantId},Limit:100});
    const candidates=rows.filter(p=>p.businessId===merchantId && p.isAvailable===true && !p.isDeleted && !p.deletedAt &&
      typeof p.categoryId==='string' && Number.isFinite(Number(p.price)) && Number(p.price)>=0 &&
      (offer.applicability!=='specificItems'||offer.itemIds.includes(p.productId)) &&
      (offer.applicability!=='specificCategories'||offer.categoryIds.includes(p.categoryId)));
    const categoryIds=[...new Set(candidates.map(p=>p.categoryId))];
    const availableCategories=new Set((await Promise.all(categoryIds.map(categoryId=>
      get(ctx.db,ctx.homeTables.categories,{categoryId}))))
      .filter(c=>(c?.businessId??c?.business_id)===merchantId && c.isActive!==false && c.is_active!==false &&
        !c.isDeleted && !c.deletedAt).map(c=>c.categoryId));
    products=candidates.filter(p=>availableCategories.has(p.categoryId)).map(p=>({
      id:p.productId,name:p.name_ar||p.name||p.productName||p.productId,price:Number(p.price),
      imageUrl:p.imageUrl||p.image||'',categoryId:p.categoryId,
    }));
  }
  return {slide,merchants,products,offer:{id:offer.id,source,title:offer.title,description:offer.description,
    imageUrl:slide.imageUrl,code:offer.code||null,type:row.type??offer.type,value:offer.value,
    minimumOrder:offer.minimumOrder,maximumSavings:offer.maximumSavings,firstOrderOnly:offer.firstOrderOnly,
    conditions:offer.audience.map(a=>conditionLabels[a]).filter(Boolean),singleUse:offer.singleUse,
    perCustomerLimit:offer.singleUse?1:offer.perCustomerLimit,applicability:offer.applicability,endAt:offer.endAt}};
}
async function slideTargetAvailable(db, slide) {
  const merchant = slide.action.type === 'discount';
  const row = await get(db, merchant ? discountTable : campaignTable, { discountId: slide.action.id });
  if (!row || (merchant && !row.businessId)) return false;
  const offer = normalize(row);
  const overlapStart = Math.max(Date.parse(slide.startAt), Date.parse(offer.startAt));
  const overlapEnd = Math.min(Date.parse(slide.endAt), Date.parse(offer.endAt));
  return overlapStart < overlapEnd && available(row, offer, overlapStart, merchant);
}

async function headerChoices(db) {
  const results = await Promise.all([campaignTable, discountTable].map(async table => {
    const rows = await pages(db, ScanCommand, { TableName: table, Limit: 100 });
    return rows.filter(row => !row.isDeleted && !row.deletedAt && row.isActive !== false &&
      row.status === 'active' && /^[-\w]{1,150}$/.test(row.discountId ?? '')).map(row => ({
      id: row.discountId,
      source: table === discountTable ? 'merchant' : row.benefit ? 'benefit' : 'platform',
      name: normalize(row).title,
    }));
  }));
  return results.flat().sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

async function discoveryFacts(ctx, scope, identity, journey) {
  const results = await Promise.all(['platform', 'merchant'].map(offerSource =>
    browse(ctx, { offerSource }, scope, identity, journey, { factsOnly: true })));
  return {
    merchantIds: [...new Set(results.flatMap(result => result.merchantIds))],
    allMerchants: results.some(result => result.allMerchants),
    expiresAt: new Date(Math.min(...results.map(result => result.expiresAt))).toISOString(),
  };
}

module.exports={browse, headerChoices, discoveryFacts, slideTargetAvailable, available, eligibility};
