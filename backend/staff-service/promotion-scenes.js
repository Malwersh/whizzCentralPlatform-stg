'use strict';
const {GetCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const TABLE='staging-MerchantPlatform';
function image(value){return typeof value==='string'&&/^https:\/\//.test(value)?value:'';}
async function menu(ctx,id){
 const key={pk:'BRANCH#'+id,sk:'MENU_VERSION#ACTIVE'};
 const pointer=(await ctx.db.send(new GetCommand({TableName:TABLE,Key:key,ConsistentRead:true}))).Item;
 if(!pointer?.publishedVersion)return [];
 const products=[];let cursor;
 for(let n=0;n<10;n++){const r=await ctx.db.send(new QueryCommand({TableName:TABLE,KeyConditionExpression:'pk=:p AND begins_with(sk,:s)',ExpressionAttributeValues:{':p':key.pk,':s':'MENU_VERSION#'+pointer.publishedVersion+'#PRODUCT#'},Limit:100,ExclusiveStartKey:cursor,ConsistentRead:true}));products.push(...(r.Items||[]).map(x=>x.product).filter(p=>p?.businessId===id&&!p.isDeleted&&!p.deletedAt&&p.isAvailable!==false&&p.publishedCategory?.isActive!==false&&p.publishedCategory?.is_active!==false));cursor=r.LastEvaluatedKey;if(!cursor)break;if(n===9)return [];}
 const after=(await ctx.db.send(new GetCommand({TableName:TABLE,Key:key,ConsistentRead:true}))).Item;
 return after?.publishedVersion===pointer.publishedVersion?products:[];
}
async function enrich(ctx,merchant,offer,settings){
 const conf=settings.scenes.find(s=>s.id===merchant.id);if(conf?.enabled===false)return null;
 ctx.promotionMenuCache ||=new Map();
 if(!ctx.promotionMenuCache.has(merchant.id))ctx.promotionMenuCache.set(merchant.id,menu(ctx,merchant.id).catch(e=>{console.warn('Promotion scene menu unavailable',{code:e.name});return [];}));
 const products=await ctx.promotionMenuCache.get(merchant.id),mode=conf?.productMode||'discounted';
 const selected=products.filter(p=>mode==='selected'?conf.productIds.includes(p.productId):mode==='menu'||offer.applicability!=='specificItems'&&offer.applicability!=='specificCategories'||offer.applicability==='specificItems'&&offer.applicable_item_ids?.includes(p.productId)||offer.applicability==='specificCategories'&&offer.applicable_category_ids?.includes(p.categoryId));
 return {id:merchant.id,name:merchant.name,logoUrl:merchant.logoUrl||'',products:selected.map(p=>({id:p.productId,name:p.name_ar||p.name||p.productName||'',imageUrl:image(p.imageUrl||p.image||p.productImageUrl)})).filter(p=>p.imageUrl).slice(0,6)};
}
module.exports={menu,enrich};
