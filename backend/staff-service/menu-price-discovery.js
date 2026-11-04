'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash}=require('node:crypto');
const PLATFORM='staging-MerchantPlatform',PRODUCTS='WhizzMerchants_Products',BUSINESSES='WhizzMerchants_Businesses',CATEGORIES='WhizzMerchants_Categories';
const id=x=>typeof x==='string'&&/^[-\w]{1,128}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
function summarize(products,categoryIds=[]){
 const seen=new Set(),prices=[];
 for(const p of products){if(!p||!id(p.productId)||seen.has(p.productId))continue;seen.add(p.productId);
  const cat=p.publishedCategory;if(p.isDeleted||p.deletedAt||p.isAvailable===false||cat?.isActive===false||cat?.is_active===false||categoryIds.length&&!categoryIds.includes(p.categoryId))continue;
  // Base menu prices before promotions, quantities and optional extras.
  if(typeof p.price==='number'&&Number.isFinite(p.price)&&p.price>0&&p.price<=1000000000)prices.push(p.price);
 }
 prices.sort((a,b)=>a-b);const n=prices.length;
 return {basis:'PUBLISHED_MENU_BASE_PRICE_MEDIAN',sampleCount:n,medianIqd:n?(prices[Math.floor((n-1)/2)]+prices[Math.floor(n/2)])/2:null};
}
async function pointer(ctx,b){return (await ctx.db.send(new GetCommand({TableName:PLATFORM,Key:{pk:'BRANCH#'+b,sk:'MENU_VERSION#ACTIVE'},ConsistentRead:true}))).Item;}
async function branch(ctx,b,categoryIds){
 const business=(await ctx.db.send(new GetCommand({TableName:BUSINESSES,Key:{businessId:b},ConsistentRead:true}))).Item;
 if(!business||business.isDeleted||business.deletedAt||business.isActive===false||business.platformSuspended===true)return null;
 const menu=await pointer(ctx,b),now=ctx.priceNow?.()??Date.now();
 const source=menu?.publishedVersion||'legacy:'+String(business.menuVersion||business.menuLastUpdated||business.updatedAt||'');
 const selectorHash=createHash('sha256').update(JSON.stringify([...categoryIds].sort())).digest('hex');
 const Key={pk:'HOME_MENU_PRICE',sk:b},cached=(await ctx.db.send(new GetCommand({TableName:ctx.table,Key}))).Item;
 if(cached?.source===source&&cached.selectorHash===selectorHash&&Date.parse(cached.expiresAt)>now)return cached;
 const products=[];let cursor,complete=false;
 for(let page=0;page<10;page++){
  const q=menu?.publishedVersion?{TableName:PLATFORM,KeyConditionExpression:'pk=:p AND begins_with(sk,:s)',ExpressionAttributeValues:{':p':'BRANCH#'+b,':s':'MENU_VERSION#'+menu.publishedVersion+'#PRODUCT#'},ConsistentRead:true}:{TableName:PRODUCTS,IndexName:'BusinessIdIndex',KeyConditionExpression:'businessId=:b',ExpressionAttributeValues:{':b':b}};
  const result=await ctx.db.send(new QueryCommand({...q,Limit:100,ExclusiveStartKey:cursor}));
  products.push(...(result.Items||[]).map(x=>menu?.publishedVersion?x.product:x).filter(x=>x?.businessId===b));cursor=result.LastEvaluatedKey;
  if(!cursor){complete=true;break;}
 }
 if(!complete)throw Error('PRICE_MENU_INCOMPLETE');
 if(!menu?.publishedVersion){
  const ids=[...new Set(products.map(p=>p.categoryId).filter(id))],cats=new Map();
  if(ids.length>100)throw Error('PRICE_CATEGORY_CAPACITY');const queue=[...ids];await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{while(queue.length){const categoryId=queue.shift(),r=await ctx.db.send(new GetCommand({TableName:CATEGORIES,Key:{categoryId}})),c=r.Item;if(c&&(!c.businessId||c.businessId===b))cats.set(c.categoryId,c);}}));
  for(const p of products)p.publishedCategory=cats.get(p.categoryId)||{isActive:false};
 }
 const after=await pointer(ctx,b);if((after?.publishedVersion||null)!==(menu?.publishedVersion||null))throw Error('PRICE_MENU_CHANGED');
 const summary={...Key,branchId:b,source,selectorHash,menuVersion:menu?.menuVersion??business.menuVersion??null,...summarize(products,categoryIds),asOf:new Date(now).toISOString(),expiresAt:new Date(now+(menu?.publishedVersion?3600000:300000)).toISOString()};
 await ctx.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:ctx.table,Item:summary}}]}));return summary;
}
async function feed(ctx,ids,profiles={}){
 if(!Array.isArray(ids)||ids.length>12||new Set(ids).size!==ids.length||ids.some(x=>!id(x)))throw Object.assign(Error('Invalid price lookup.'),{status:400});
 const result={},queue=[...ids];await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{while(queue.length){const b=queue.shift();try{const data=await branch(ctx,b,profiles[b]?.priceCategoryIds||[]);if(data)result[b]={basis:data.basis,sampleCount:data.sampleCount,medianIqd:data.medianIqd,menuVersion:data.menuVersion,asOf:data.asOf,expiresAt:data.expiresAt};}catch(e){console.warn('Menu price snapshot unavailable',{code:e.name||'Error'});}}}));return result;
}
module.exports={summarize,feed,branch};
