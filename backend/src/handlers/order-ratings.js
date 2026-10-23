'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {CognitoJwtVerifier}=require('aws-jwt-verify');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(v);
const fail=(code,status=400)=>Object.assign(new Error(code),{code,status});
const validStars=v=>Number.isInteger(v)&&v>=1&&v<=5;
const publicReview=r=>r?{merchantStars:r.merchantStars,driverStars:r.driverStars??null,comment:r.comment,createdAt:r.createdAt}:null;
function nextAggregate(previous,pk,stars){
 if(previous&&(!Number.isSafeInteger(previous.count)||previous.count<1||!Number.isSafeInteger(previous.sum)||previous.sum<previous.count||previous.sum>previous.count*5||!Number.isSafeInteger(previous.version)||previous.version<1))throw fail('RATINGS_UNAVAILABLE',503);
 const count=(previous?.count||0)+1,sum=(previous?.sum||0)+stars;
 if(!Number.isSafeInteger(sum)||!Number.isSafeInteger(count))throw fail('RATINGS_UNAVAILABLE',503);
 return {pk,count,sum,average:Math.round(sum/count*100)/100,version:(previous?.version||0)+1};
}
function createHandler({db,verify,env=process.env,now=()=>new Date().toISOString()}){
 const get=async(table,key)=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 async function context(subject,orderId){
  const order=await get(env.ORDERS_TABLE,{PK:'ORDER#'+orderId,SK:'META'});
  if(!order||order.orderId!==orderId||order.isGuestOrder===true||order.isDeleted===true||order.deletedAt||order.deletionRequestId||
   (order.userSub!=null?order.userSub!==subject:!(order.userId===subject||order.customerId===subject)))throw fail('ORDER_FORBIDDEN',403);
  if(!id(order.userId))throw fail('ORDER_FORBIDDEN',403);
  const customer=await get(env.CUSTOMERS_TABLE,{userId:order.userId});
  if(!customer||customer.isActive===false||customer.deletionRequestId||customer.deletedAt||(customer.cognitoSub!=null&&customer.cognitoSub!==subject))throw fail('ORDER_FORBIDDEN',403);
  if(!['delivered','completed'].includes(order.status))throw fail('ORDER_NOT_DELIVERED',409);
  if(!id(order.storeId)|| (order.driverId!=null&&order.driverId!==''&&!id(order.driverId)))throw fail('RATINGS_UNAVAILABLE',503);
  const merchant=await get(env.MERCHANTS_TABLE,{businessId:order.storeId});
  const driver=order.driverId?await get(env.DRIVERS_TABLE,{driverId:order.driverId}):null;
  if(!merchant||merchant.deletionRequestId||merchant.deletedAt||(order.driverId&&(!driver||driver.deletionRequestId||driver.deletedAt)))throw fail('RATINGS_UNAVAILABLE',503);
  return {order,customer,merchant,driver};
 }
 return async event=>{
  const reply=(statusCode,value)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(value)});
  try{
   const method=event.httpMethod; if(!['GET','POST'].includes(method))throw fail('METHOD_NOT_ALLOWED',405);
   let claims;try{const h=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));claims=await verify(String(h.authorization||'').replace(/^Bearer\s+/i,''));if(!id(claims?.sub))throw Error();}catch(_){throw fail('UNAUTHORIZED',401);}
   const orderId=event.pathParameters?.orderId;if(!id(orderId))throw fail('ORDER_ID_INVALID');
   if(![env.ORDERS_TABLE,env.CUSTOMERS_TABLE,env.MERCHANTS_TABLE,env.DRIVERS_TABLE,env.RATINGS_TABLE].every(Boolean))throw fail('RATINGS_UNAVAILABLE',503);
   let body;
   if(method==='POST'){
    if(event.isBase64Encoded||typeof event.body!=='string'||Buffer.byteLength(event.body)>4096)throw fail('RATING_INVALID');
    try{body=JSON.parse(event.body);}catch(_){throw fail('RATING_INVALID');}
    if(!body||Array.isArray(body)||!validStars(body.merchantStars)|| (body.driverStars!=null&&!validStars(body.driverStars))|| (body.comment!=null&&(typeof body.comment!=='string'||body.comment.trim().length>500)))throw fail('RATING_INVALID');
    body={merchantStars:body.merchantStars,driverStars:body.driverStars??null,comment:(body.comment||'').trim()};
   }
   for(let attempt=0;attempt<4;attempt++){
    const {order,merchant,driver}=await context(claims.sub,orderId);
    const existing=await get(env.RATINGS_TABLE,{pk:'ORDER#'+orderId});
    if(existing&&existing.subjectId!==claims.sub)throw fail('ORDER_FORBIDDEN',403);
    if(method==='GET')return reply(200,{success:true,orderId,merchantName:merchant.businessName||merchant.name||'المطعم',driverName:driver?.name||driver?.fullName||'السائق',driverEligible:!!driver,review:publicReview(existing)});
    if(!!driver!==(body.driverStars!=null))throw fail('DRIVER_RATING_INVALID');
    if(existing){
     if(existing.subjectId!==claims.sub)throw fail('ORDER_FORBIDDEN',403);
     if(existing.merchantStars!==body.merchantStars||existing.driverStars!==body.driverStars||existing.comment!==body.comment)throw fail('ALREADY_RATED',409);
     return reply(200,{success:true,orderId,review:publicReview(existing),alreadySaved:true});
    }
    const createdAt=now();const record={pk:'ORDER#'+orderId,orderId,subjectId:claims.sub,merchantId:order.storeId,driverId:order.driverId||null,...body,createdAt};
    // Recheck ownership, delivery status, recipient identities and account lifecycle atomically.
    const names={'#status':'status'};const values={':status':order.status,':uid':order.userId,':mid':order.storeId,':no':false,':null':null};
    let condition='#status=:status AND userId=:uid AND storeId=:mid AND (attribute_not_exists(isGuestOrder) OR isGuestOrder=:no) AND (attribute_not_exists(isDeleted) OR isDeleted=:no) AND (attribute_not_exists(deletedAt) OR deletedAt=:null) AND (attribute_not_exists(deletionRequestId) OR deletionRequestId=:null)';
    for(const field of ['userSub','customerId','driverId']){if(Object.hasOwn(order,field)){values[':'+field]=order[field];condition+=' AND '+field+'=:'+field;}else condition+=' AND attribute_not_exists('+field+')';}
    const tx=[{ConditionCheck:{TableName:env.ORDERS_TABLE,Key:{PK:'ORDER#'+orderId,SK:'META'},ConditionExpression:condition,ExpressionAttributeNames:names,ExpressionAttributeValues:values}},
     {ConditionCheck:{TableName:env.CUSTOMERS_TABLE,Key:{userId:order.userId},ConditionExpression:'attribute_exists(userId) AND (attribute_not_exists(isActive) OR isActive=:yes) AND (attribute_not_exists(deletionRequestId) OR deletionRequestId=:null) AND (attribute_not_exists(deletedAt) OR deletedAt=:null) AND (attribute_not_exists(cognitoSub) OR cognitoSub=:sub OR cognitoSub=:null)',ExpressionAttributeValues:{':yes':true,':sub':claims.sub,':null':null}}},
     {Put:{TableName:env.RATINGS_TABLE,Item:record,ConditionExpression:'attribute_not_exists(pk)'}}];
    for(const target of [{prefix:'MERCHANT#',targetId:order.storeId,table:env.MERCHANTS_TABLE,key:'businessId',stars:body.merchantStars},...(driver?[{prefix:'DRIVER#',targetId:order.driverId,table:env.DRIVERS_TABLE,key:'driverId',stars:body.driverStars}]:[])]){
     const pk=target.prefix+target.targetId,previous=await get(env.RATINGS_TABLE,{pk}),aggregate=nextAggregate(previous,pk,target.stars);
     tx.push({Put:{TableName:env.RATINGS_TABLE,Item:aggregate,ConditionExpression:previous?'#version=:previous':'attribute_not_exists(pk)',...(previous?{ExpressionAttributeNames:{'#version':'version'},ExpressionAttributeValues:{':previous':previous.version}}:{})}});
     tx.push({Update:{TableName:target.table,Key:{[target.key]:target.targetId},UpdateExpression:'SET customerRating=:avg, customerRatingCount=:count, customerRatingSum=:sum, customerRatingUpdatedAt=:at',ConditionExpression:'attribute_exists('+target.key+') AND (attribute_not_exists(deletionRequestId) OR deletionRequestId=:null) AND (attribute_not_exists(deletedAt) OR deletedAt=:null)',ExpressionAttributeValues:{':avg':aggregate.average,':count':aggregate.count,':sum':aggregate.sum,':at':createdAt,':null':null}}});
    }
    try{await db.send(new TransactWriteCommand({TransactItems:tx}));return reply(200,{success:true,orderId,review:publicReview(record)});}catch(error){if(error.name!=='TransactionCanceledException'&&error.name!=='TransactionConflictException')throw error;}
   }
   throw fail('RATING_CONFLICT',409);
  }catch(error){if(!error.status)console.error('Ratings backend failure', {name:error.name});return reply(error.status||503,{success:false,code:error.status?error.code:'RATINGS_UNAVAILABLE'});}
 };
}
let verifier;
const verify=async token=>{
 if(!process.env.CUSTOMERS_USER_POOL_ID||!process.env.CUSTOMERS_CLIENT_ID)throw Error('Missing configuration');
 verifier||=CognitoJwtVerifier.create({userPoolId:process.env.CUSTOMERS_USER_POOL_ID,clientId:process.env.CUSTOMERS_CLIENT_ID,tokenUse:'access'});
 return verifier.verify(token);
};
const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
module.exports={createHandler,nextAggregate,handler:createHandler({db,verify})};
