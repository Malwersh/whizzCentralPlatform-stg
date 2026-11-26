'use strict';

const {createHash}=require('node:crypto');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient,GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {CognitoIdentityProviderClient,GetUserCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {identities:{customer}}=require('./wallet-identity-bindings.json');
const {accountGuard}=require('../../../wizzuser-stg/backend/src/functions/create-order/account-guard');
const {visible}=require('../../../wizzuser-stg/backend/src/production/branch-menu-catalog');

const list='/users/{user_id}/favorites';
const remove=list+'/{favorite_id}';
const status=list+'/check/{business_id}';
const paths=new Map([[list,['GET','POST']],[remove,['DELETE']],[status,['GET']]]);
const tables={
  favorites:'wizz-production-Favorites', customers:'wizz-production-Customers',
  merchants:'wizz-production-Merchants', lifecycle:'wizz-production-AccountDeletion',
};
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});
const fail=(statusCode,code,message)=>Object.assign(new Error(message),{statusCode,code});
const invalid=()=>fail(400,'INVALID_REQUEST','راجع بيانات المفضلة.');
const unavailable=()=>fail(403,'ACCOUNT_UNAVAILABLE','الحساب غير متاح.');
const id=value=>typeof value==='string' && /^[A-Za-z0-9_.:-]{1,150}$/.test(value);
const display=(...values)=>values.find(v=>typeof v==='string'&&v.trim())?.trim()??null;
const dto=row=>({id:row.favoriteId,user_id:row.userId,business_id:row.businessId,business_name:row.businessName,
  business_image:row.businessImage??null,business_category:row.businessCategory??null,
  favorite_type:row.favoriteType,created_at:row.createdAt,updated_at:row.updatedAt});
const stableId=(owner,business,type)=>'fav_'+createHash('sha256').update(JSON.stringify([owner,business,type])).digest('hex');
const finalConditionFailed=error=>error?.name==='TransactionCanceledException' &&
  error.CancellationReasons?.[0]?.Code==='None' && error.CancellationReasons?.[1]?.Code==='None' &&
  error.CancellationReasons?.[2]?.Code==='ConditionalCheckFailed';

function createHandler({db,getUser,apiId,now=()=>new Date()}){
  const get=async (TableName,Key)=>(await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;

  async function *rows(owner,type,business){
    const expression={':owner':owner,':type':type};
    const index=business?'userId-businessId-index':'userId-createdAt-index';
    if(business)expression[':business']=business;
    let cursor;
    do {
      const result=await db.send(new QueryCommand({TableName:tables.favorites,IndexName:index,
        KeyConditionExpression:'userId = :owner'+(business?' AND businessId = :business':''),
        FilterExpression:'favoriteType = :type',ExpressionAttributeValues:expression,
        ScanIndexForward:false,ExclusiveStartKey:cursor}));
      yield* (result.Items??[]);
      cursor=result.LastEvaluatedKey;
    } while(cursor);
  }

  async function find(owner,business,type){
    const key=stableId(owner,business,type);
    const current=await get(tables.favorites,{favoriteId:key});
    if(current?.userId===owner && current.businessId===business && current.favoriteType===type)return current;
    for await(const row of rows(owner,type,business)){
      if(row.favoriteId===key||!id(row.favoriteId)||!row.favoriteId.startsWith('fav_'))continue;
      const legacy=await get(tables.favorites,{favoriteId:row.favoriteId});
      if(legacy?.userId===owner && legacy.businessId===business && legacy.favoriteType===type)return legacy;
    }
    return null;
  }

  return async event=>{
    try {
      const methods=paths.get(event?.resource);
      if(event?.requestContext?.stage!=='production'||event.requestContext.apiId!==apiId||!methods)
        throw fail(404,'NOT_FOUND','الخدمة غير موجودة.');
      if(!methods.includes(event.httpMethod))throw fail(405,'METHOD_NOT_ALLOWED','الإجراء غير متاح.');
      const owner=event.pathParameters?.user_id;
      if(!id(owner)||owner==='guest'||owner.startsWith('GUEST_'))throw invalid();
      const tokens=Object.entries(event.headers??{}).filter(([name])=>name.toLowerCase()==='authorization');
      if(tokens.length!==1||typeof tokens[0][1]!=='string'||tokens[0][1].length>8200)
        throw fail(401,'AUTH_REQUIRED','يجب تسجيل الدخول أولاً.');
      const actor=await accountGuard({event:{headers:{Authorization:tokens[0][1]}},userId:owner,
        pool:customer.poolId,clientId:customer.clientId,profilesTable:tables.customers,getUser,
        getProfile:async userId=>{
          const profile=await get(tables.customers,{userId});
          return profile?.isDeleted||profile?.deletedAt||profile?.deletionRequestId?null:profile;
        }});
      const lifeKey={pk:'ACCOUNT_LIFECYCLE#CUSTOMER#'+actor.sub,sk:'META'};
      if(await get(tables.lifecycle,lifeKey))throw unavailable();
      const fence=actor.condition.ConditionCheck;
      fence.ConditionExpression=fence.ConditionExpression.replace('attribute_not_exists(deletionRequestId)',
        '(attribute_not_exists(deletionRequestId) OR attribute_type(deletionRequestId,:nullType))');
      fence.ConditionExpression+=' AND (attribute_not_exists(isDeleted) OR isDeleted <> :deleted) AND (attribute_not_exists(deletedAt) OR attribute_type(deletedAt,:nullType))';
      Object.assign(fence.ExpressionAttributeValues,{':deleted':true,':nullType':'NULL'});
      const write=operation=>db.send(new TransactWriteCommand({TransactItems:[
        actor.condition,{ConditionCheck:{TableName:tables.lifecycle,Key:lifeKey,ConditionExpression:'attribute_not_exists(pk)'}},operation,
      ]}));
      if(event.resource===remove){
        const favoriteId=event.pathParameters?.favorite_id;
        if(!id(favoriteId)||!favoriteId.startsWith('fav_'))throw invalid();
        try {
          await write({Delete:{TableName:tables.favorites,Key:{favoriteId},
            ConditionExpression:'attribute_not_exists(favoriteId) OR userId = :owner',ExpressionAttributeValues:{':owner':owner}}});
        } catch(error) {
          // The caller sees the same result for an absent row and a row outside their account.
          if(!finalConditionFailed(error))throw error;
        }
        return reply(200,{success:true,message:'تم حذف المطعم من المفضلة.'});
      }
      let input={};
      if(event.httpMethod==='POST'){
        try {
          if(event.isBase64Encoded||typeof event.body!=='string'||Buffer.byteLength(event.body)>12000)throw Error();
          input=JSON.parse(event.body);
          if(!input||typeof input!=='object'||Array.isArray(input))throw Error();
        } catch { throw invalid(); }
      }
      const type=input.favoriteType??event.queryStringParameters?.type??'restaurant';
      if(typeof type!=='string'||!/^[a-z][a-z0-9_-]{0,39}$/.test(type))throw invalid();
      if(event.resource===list&&event.httpMethod==='GET'){
        const favorites=[];
        for await(const row of rows(owner,type))favorites.push(dto(row));
        return reply(200,{success:true,data:{favorites,total:favorites.length,favorite_type:type}});
      }
      const businessId=input.businessId??event.pathParameters?.business_id;
      if(!id(businessId))throw invalid();
      const current=await find(owner,businessId,type);
      if(event.resource===status)return reply(200,{success:true,data:{is_favorite:!!current,favorite_id:current?.favoriteId??null,
        business_id:businessId,user_id:owner,favorite_type:type}});
      if(current)return reply(200,{success:true,data:dto(current)});
      const branch=await get(tables.merchants,{businessId});
      const name=branch&&display(branch.businessName,branch.business_name,branch.name);
      if(!visible(branch)||!name)throw fail(404,'BUSINESS_UNAVAILABLE','المطعم غير متاح.');
      const at=now().toISOString();
      const item={favoriteId:stableId(owner,businessId,type),userId:owner,businessId,favoriteType:type,
        businessName:name,businessImage:display(branch.businessPhotoUrl,branch.business_photo_url,branch.logoUrl,branch.imageUrl),
        businessCategory:display(branch.categoryNameAr,branch.category,branch.businessType),createdAt:at,updatedAt:at};
      try {
        await write({Put:{TableName:tables.favorites,Item:item,ConditionExpression:'attribute_not_exists(favoriteId)'}});
      } catch(error) {
        if(!finalConditionFailed(error))throw error;
        const saved=await get(tables.favorites,{favoriteId:item.favoriteId});
        if(saved?.userId!==owner||saved.businessId!==businessId||saved.favoriteType!==type)throw error;
        return reply(200,{success:true,data:dto(saved)});
      }
      return reply(201,{success:true,message:'تم إضافة المطعم إلى المفضلة.',data:dto(item)});
    } catch(error) {
      if(error?.name==='TransactionCanceledException')return reply(409,{success:false,code:'FAVORITE_CHANGED',message:'تغيرت المفضلة أو حالة الحساب. حدّث القائمة.'});
      const code=error?.statusCode||503;
      if(code>=500)console.error('Favorites request unavailable',{name:error?.name});
      const message=error?.code==='AUTH_REQUIRED'?'يجب تسجيل الدخول أولاً.':
        error?.code==='ACCOUNT_MISMATCH'?'المفضلة تخص حسابًا آخر.':
        error?.code==='ACCOUNT_UNAVAILABLE'?'الحساب غير متاح.':
        code>=500?'تعذر تحديث المفضلة. أعد المحاولة.':error.message;
      return reply(code,{success:false,code:error?.code||'FAVORITES_UNAVAILABLE',message});
    }
  };
}
const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1',maxAttempts:2}));
const identity=new CognitoIdentityProviderClient({region:'us-east-1',maxAttempts:2});
const apiId=process.env.CUSTOMER_FAVORITES_API_ID;
const production=createHandler({db,apiId,getUser:token=>identity.send(new GetUserCommand({AccessToken:token}))});
module.exports={createHandler,handler(event){
  if(process.env.STAGE!=='production'||process.env.AWS_REGION!=='us-east-1'||!(/^[a-z0-9]{10}$/.test(apiId??'')))
    return reply(503,{success:false,code:'FAVORITES_UNAVAILABLE',message:'خدمة المفضلة غير متاحة.'});
  return production(event);
}};
