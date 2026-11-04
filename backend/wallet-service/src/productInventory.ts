import {GetCommand,QueryCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {randomUUID,createHash} from 'node:crypto';
type Row=Record<string,any>;
const products=()=>process.env.INVENTORY_PRODUCTS_TABLE||'WhizzMerchants_Products';
const platform=()=>process.env.INVENTORY_PLATFORM_TABLE||'staging-MerchantPlatform';
const orders=()=>process.env.INVENTORY_ORDERS_TABLE||'WizzOrders';
const fail=(code:string,status=409):never=>{throw Object.assign(Error(code),{status,statusCode:status,code});};
const id=(v:any)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(v);
const quantity=(v:any)=>Number.isSafeInteger(v)&&v>=0&&v<=1000000;
const get=async(db:any,TableName:string,Key:Row)=>(await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;
const key=(b:string,o:string)=>({pk:'BRANCH#'+b,sk:'INVENTORY_RESERVATION#'+o});
const audit=(b:string,actor:Row,action:string,entityId:string,details:Row)=>({Put:{TableName:platform(),Item:{pk:'BRANCH#'+b,sk:'STAFF_AUDIT#OPERATIONS#'+new Date().toISOString()+'#'+randomUUID(),businessId:b,ownerId:actor.ownerId||actor.sub||'',actorId:actor.sub||'INVENTORY_WORKER',action,entityId,result:'SUCCEEDED',createdAt:new Date().toISOString(),...details},ConditionExpression:'attribute_not_exists(pk)'}});
/** Returns operations only. Caller commits these atomically with the NEW order, never an invoice preview. */
export async function reserveProductInventory(db:any,order:Row,operations:Row[]){
 const branch=order.storeId,orderId=order.orderId;
 if(!id(branch)||!id(orderId)||!Array.isArray(order.items))return fail('INVALID_INVENTORY_ORDER',400);
 const totals=new Map<string,number>();
 for(const item of order.items){const p=item.itemId||item.productId;if(!id(p)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>1000)return fail('INVALID_INVENTORY_ORDER',400);totals.set(p,(totals.get(p)||0)+item.quantity);}
 if(totals.size>40)return fail('INVALID_INVENTORY_ORDER',400);
 let output:Row[]=JSON.parse(JSON.stringify(operations));const lines:Row[]=[];
 const existing=await get(db,platform(),key(branch,orderId));if(existing){const saved=await get(db,orders(),{PK:'ORDER#'+orderId,SK:'META'});if(saved?.storeId===branch)return output;return fail('INVENTORY_RESERVATION_CONFLICT');}
 const currentProducts=new Map(await Promise.all([...totals.keys()].map(async productId=>[productId,await get(db,products(),{productId})] as const)));
 for(const [productId,count] of totals){
  const product=currentProducts.get(productId);
  if(!product||product.businessId!==branch||product.isAvailable!==true)return fail('GOODS_UNAVAILABLE');
  if(product.stock!==undefined&&(!quantity(product.stock)||product.stock<count))return fail('INSUFFICIENT_STOCK');
  const checks=output.filter((o:Row)=>o.ConditionCheck?.TableName===products()&&o.ConditionCheck.Key?.productId===productId).map(o=>o.ConditionCheck);
  const prior=checks[0]||{TableName:products(),Key:{productId},ConditionExpression:'businessId=:ivb AND isAvailable=:ivy',ExpressionAttributeValues:{':ivb':branch,':ivy':true}};
  for(let i=1;i<checks.length;i++){
   const next=checks[i];if(JSON.stringify(prior)===JSON.stringify(next))continue;
   const aliases:Row={},names:Row={},values:Row={};
   for(const [n,v] of Object.entries(next.ExpressionAttributeNames||{})){const alias='#ivmerge'+i+n.slice(1);aliases[n]=alias;names[alias]=v;}
   for(const [n,v] of Object.entries(next.ExpressionAttributeValues||{})){const alias=':ivmerge'+i+n.slice(1);aliases[n]=alias;values[alias]=v;}
   const expression=next.ConditionExpression.replace(/#[A-Za-z0-9_]+|:[A-Za-z0-9_]+/g,(token:string)=>aliases[token]||token);
   prior.ConditionExpression='('+prior.ConditionExpression+') AND ('+expression+')';prior.ExpressionAttributeNames={...prior.ExpressionAttributeNames,...names};prior.ExpressionAttributeValues={...prior.ExpressionAttributeValues,...values};
  }
  output=output.filter((o:Row)=>!(o.ConditionCheck?.TableName===products()&&o.ConditionCheck.Key?.productId===productId));
  const limited=product.stock!==undefined;
  const op={...prior,ConditionExpression:'('+prior.ConditionExpression+') AND '+(limited?'#ivstock >= :ivcount AND #ivstock = :ivstock':'attribute_not_exists(#ivstock)'),ExpressionAttributeNames:{...prior.ExpressionAttributeNames,'#ivstock':'stock'},ExpressionAttributeValues:{...prior.ExpressionAttributeValues,...(limited?{':ivcount':count,':ivstock':product.stock}:{})}};
  const record=limited?{Update:{...op,UpdateExpression:'SET #ivstock = #ivstock - :ivcount'}}:{ConditionCheck:op};
  output.push(record);
  if(limited)lines.push({productId,quantity:count});
 }
 if(lines.length){output.push({Put:{TableName:platform(),Item:{...key(branch,orderId),businessId:branch,orderId,status:'RESERVED',lines,createdAt:new Date().toISOString()},ConditionExpression:'attribute_not_exists(pk)'}});order.inventoryReservation={schemaVersion:1,branchId:branch,orderId};}
 return output;
}
export async function setProductStock(db:any,branch:string,body:Row,actor:Row){
 if(!id(body?.productId)||!id(body?.requestId)||!(body.stock===null||quantity(body.stock))||!(body.expectedStock===null||quantity(body.expectedStock)))return fail('INVALID_STOCK_REQUEST',400);
 const marker={pk:'BRANCH#'+branch,sk:'INVENTORY_ADJUST#'+body.requestId};
 const fingerprint=createHash('sha256').update(JSON.stringify({productId:body.productId,stock:body.stock,expectedStock:body.expectedStock})).digest('hex');
 const replay=await get(db,platform(),marker);if(replay){if(replay.fingerprint!==fingerprint)return fail('REQUEST_ID_CONFLICT');return replay.result;}
 const before=await get(db,products(),{productId:body.productId});if(!before||before.businessId!==branch)return fail('PRODUCT_UNAVAILABLE',404);
 if((before.stock??null)!==body.expectedStock)return fail('STOCK_CHANGED');
 const result={productId:body.productId,stock:body.stock};
 await db.send(new TransactWriteCommand({TransactItems:[
 {Update:{TableName:products(),Key:{productId:body.productId},ConditionExpression:'businessId=:b AND '+(before.stock===undefined?'attribute_not_exists(#s)':'#s=:old'),UpdateExpression:body.stock===null?'REMOVE #s':'SET #s=:new',ExpressionAttributeNames:{'#s':'stock'},ExpressionAttributeValues:{':b':branch,...(before.stock===undefined?{}:{':old':before.stock}),...(body.stock===null?{}:{':new':body.stock})}}},
 {Put:{TableName:platform(),Item:{...marker,businessId:branch,fingerprint,result,createdAt:new Date().toISOString()},ConditionExpression:'attribute_not_exists(pk)'}},
 audit(branch,actor,'PRODUCT_STOCK_ADJUSTED',body.productId,{before:{stock:before.stock??null},after:result})]}));return result;
}
export const inventoryTerminalStatus=(value:any)=>typeof value==='string'&&(['delivered','completed','returned','cancelled','canceled','rejected','failed','expired'].includes(value.toLowerCase())||/^(canceled|cancelled)_by_/.test(value.toLowerCase()));
const canceled=(o:Row)=>inventoryTerminalStatus(o.status)&&!['delivered','completed'].includes(String(o.status).toLowerCase());
const prepared=(o:Row)=>!!(o.inKitchenAt||o.preparingAt||o.preparationStartedAt||o.readyAt||o.pickupAt||o.pickedUpAt||o.deliveredAt)||['preparing','in_kitchen','ready','ready_for_pickup','picked_up','out_for_delivery','delivered','completed'].includes(String(o.status||''));
/** Current order is strongly read, never trust a caller-provided cancellation status. */
export async function reconcileOrderInventory(db:any,branch:string,orderId:string,decision?:'RESTOCK'|'CONSUMED',actor:Row={}){
 const record=await get(db,platform(),key(branch,orderId));if(!record||['RESTOCKED','CONSUMED'].includes(record.status))return record||null;
 const order=await get(db,orders(),{PK:'ORDER#'+orderId,SK:'META'});if(!order||order.storeId!==branch)return fail('ORDER_UNAVAILABLE');
 if(['delivered','completed'].includes(order.status))decision='CONSUMED';
 else if(!canceled(order))return record;
 else if(!decision){
  // Missing preparation evidence is not sufficient proof for restoring perishable goods.
  if(record.status==='REVIEW_REQUIRED')return record;
  const next={...record,status:'REVIEW_REQUIRED',reason:prepared(order)?'CANCELLED_AFTER_PREPARATION':'CANCELLED_REQUIRES_STOCK_REVIEW',updatedAt:new Date().toISOString()};
  await db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:platform(),Item:next,ConditionExpression:'#s=:old',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':old':record.status}}}]}));return next;
 }
 if(decision!=='RESTOCK'&&decision!=='CONSUMED')return fail('INVALID_STOCK_DECISION',400);
 const mutations:Row[]=[];
 if(decision==='RESTOCK')for(const line of record.lines){const product=await get(db,products(),{productId:line.productId});if(!product||product.businessId!==branch||!quantity(product.stock)||product.stock+line.quantity>1000000)return fail('RESTOCK_PRODUCT_REVIEW_REQUIRED');mutations.push({Update:{TableName:products(),Key:{productId:line.productId},ConditionExpression:'businessId=:b AND #s=:old',UpdateExpression:'SET #s=#s+:q',ExpressionAttributeNames:{'#s':'stock'},ExpressionAttributeValues:{':b':branch,':old':product.stock,':q':line.quantity}}});}
 const next={...record,status:decision==='RESTOCK'?'RESTOCKED':'CONSUMED',decisionBy:actor.sub||'INVENTORY_WORKER',updatedAt:new Date().toISOString()};
 await db.send(new TransactWriteCommand({TransactItems:[...mutations,{ConditionCheck:{TableName:orders(),Key:{PK:order.PK,SK:order.SK},ConditionExpression:'#s=:s AND storeId=:b',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':order.status,':b':branch}}},{Put:{TableName:platform(),Item:next,ConditionExpression:'#s=:old',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':old':record.status}}},audit(branch,actor,'ORDER_STOCK_'+next.status,orderId,{lines:record.lines})]}));return next;
}
export async function listInventoryReviews(db:any,branch:string){const rows:Row[]=[];let cursor:any;do{const r:any=await db.send(new QueryCommand({TableName:platform(),KeyConditionExpression:'pk=:p AND begins_with(sk,:s)',ExpressionAttributeValues:{':p':'BRANCH#'+branch,':s':'INVENTORY_RESERVATION#'},ConsistentRead:true,Limit:100,...(cursor?{ExclusiveStartKey:cursor}:{})}));rows.push(...(r.Items||[]).filter((x:Row)=>['RESERVED','REVIEW_REQUIRED'].includes(x.status)));cursor=r.LastEvaluatedKey;if(rows.length>1000)return fail('INVENTORY_REVIEW_TOO_LARGE');}while(cursor);return rows;}
