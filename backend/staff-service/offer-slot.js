'use strict';
// Presentation policy only: no amounts, customer eligibility, grant or redemption writes.
const {GetCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const validId=v=>typeof v==='string'&&/^[-\w]{1,150}$/.test(v);
const defaults=()=>({mode:'automatic',sources:['merchant','platform','shared'],kinds:['items','order','delivery'],refs:[],style:'spotlight',presentation:'card',maxCards:4,showImage:true,showSource:true});
function validate(raw){
 if(raw==null)return defaults();
 if(typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['mode','sources','kinds','refs','style','presentation','maxCards','showImage','showSource'].includes(k)))throw fail('Invalid offer slot.');
 const v={...defaults(),...raw};
 if(!['card','image'].includes(v.presentation)||!['automatic','manual'].includes(v.mode)||!['spotlight','carousel','list'].includes(v.style)||!Number.isInteger(v.maxCards)||v.maxCards<1||v.maxCards>6||typeof v.showImage!=='boolean'||typeof v.showSource!=='boolean')throw fail('Invalid offer presentation.');
 for(const [key,allowed]of [['sources',['merchant','platform','shared']],['kinds',['items','order','delivery']]])if(!Array.isArray(v[key])||!v[key].length||new Set(v[key]).size!==v[key].length||v[key].some(x=>!allowed.includes(x)))throw fail('Choose offer filters.');
 if(!Array.isArray(v.refs)||v.refs.length>20||v.refs.some(r=>!r||Object.keys(r).sort().join(',')!=='id,source'||!['merchant','platform','benefit'].includes(r.source)||!validId(r.id))||new Set(v.refs.map(r=>r.source+':'+r.id)).size!==v.refs.length||(v.mode==='manual'&&!v.refs.length))throw fail('Choose campaign references.');
 return {...v,refs:v.mode==='manual'?v.refs:[]};
}
function classify(row){return row.fundingPolicyId?'shared':row.businessId?'merchant':'platform';}
function kind(row){return row.type==='freeDelivery'?'delivery':['specificItems','specificCategories'].includes(row.applicability)?'items':'order';}
async function validateRefs(ctx,templates){
 const refs=new Map();for(const t of templates)for(const s of t.sections)if(s.source==='offers'&&s.offerSlot?.mode==='manual')for(const ref of s.offerSlot.refs){const key=ref.source+':'+ref.id;if(!refs.has(key))refs.set(key,(await ctx.db.send(new GetCommand({TableName:ref.source==='merchant'?'WhizzMerchants_Discounts':'WizzCentral_Platform_Discounts',Key:{discountId:ref.id},ConsistentRead:true}))).Item);const row=refs.get(key);if(!row||row.isDeleted||row.deletedAt||(ref.source==='benefit')!==!!row.benefit)throw fail('Selected offer is unavailable.');const targets=[row.benefit?.branchIds,row.targetRestaurants,row.allowedBusinessIds,row.businessIds,row.businessId?[row.businessId]:[]].find(v=>Array.isArray(v)&&v.length)||[];if(t.target.branchIds.length&&targets.length&&!t.target.branchIds.some(id=>targets.includes(id)))throw fail('Offer does not belong to template branches.');}
}
const cache=new WeakMap();
async function rows(ctx){let value=cache.get(ctx.db);if(!value||value.until<=Date.now()){
 const pending=(async()=>{const all=[];for(const [table,source]of [['WhizzMerchants_Discounts','merchant'],['WizzCentral_Platform_Discounts','platform']]){let cursor;for(let page=0;page<20;page++){const r=await ctx.db.send(new ScanCommand({TableName:table,Limit:100,ExclusiveStartKey:cursor}));all.push(...(r.Items||[]).map(row=>({row,source})));if(all.length>2000)throw fail('Offer capacity exceeded.',503);cursor=r.LastEvaluatedKey;if(!cursor)break;if(page===19)throw fail('Offer list incomplete.',503);}}return all;})();value={until:Date.now()+15000,pending};cache.set(ctx.db,value);pending.catch(()=>cache.delete(ctx.db));
 }return value.pending;}
async function feed(ctx,scope,branch,slots=[defaults()]){
 if(!scope.offerLive||!scope.eligibility||!scope.offerInfo)return [];
 const specs=slots.map(validate),candidates=await rows(ctx),out=[];let customer;
 for(const {row,source}of candidates){
  if(row.benefit||row.isDeleted||row.deletedAt||source==='merchant'&&row.businessId!==branch||!scope.offerLive(row))continue;
  if(!specs.some(s=>s.sources.includes(classify(row))&&s.kinds.includes(kind(row))&&(s.mode==='automatic'||s.refs.some(r=>r.source===source&&r.id===row.discountId))))continue;
  // A platform campaign must have a supported redemption destination.
  if(source==='platform'&&!row.code)continue;
  try{customer??=scope.identity?await scope.getCustomer():null;await scope.eligibility(ctx.db,row,{identity:scope.identity,customer,regionIds:scope.regionIds,branchId:branch,source,preview:true});}catch(e){if(e.status===409||e.statusCode===409)continue;throw e;}
  if(source==='platform'&&row.type==='freeDelivery')continue; // delivery grants use existing benefit eligibility service
  const o=scope.offerInfo(row);let imageUrl=row.imageUrl||row.image_url||row.image||'';
  if(o.imageKey&&scope.imageUrl)imageUrl=await scope.imageUrl(o.imageKey);
  out.push({id:row.discountId,source,origin:classify(row),kind:kind(row),title:o.title,description:o.description,type:o.type,value:o.value,minimumOrder:o.minimumOrder,maximumSavings:o.maximumSavings,calculationMode:row.calculationMode||'order',applicability:row.applicability||'allItems',itemIds:row.applicable_item_ids||[],categoryIds:row.applicable_category_ids||[],startAt:o.startAt||null,endAt:o.endAt||null,firstOrderOnly:o.firstOrderOnly,perCustomerLimit:o.perCustomerLimit,singleUse:o.singleUse,imageUrl,code:source==='platform'?o.code:null});
 }
 return out;
}
module.exports={defaults,validate,validateRefs,feed,classify,kind};
