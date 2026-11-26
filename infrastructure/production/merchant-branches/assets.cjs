'use strict';
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {S3Client,PutObjectCommand,GetObjectCommand}=require('@aws-sdk/client-s3');
const {getSignedUrl}=require('@aws-sdk/s3-request-presigner');
const {createHash,randomUUID}=require('node:crypto');
const BUCKET='wizz-production-merchant-onboarding-746727375268',TABLE='wizz-production-MerchantPlatform',OWNER='746727375268',MAX_BYTES=3*1024*1024;
const fail=(code,status=400)=>Object.assign(Error(code),{status});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
function decode(input){
 if(!uuid(input.draftId)||!uuid(input.assetId)||!['REGISTRATION_CERTIFICATE','BUSINESS_PHOTO'].includes(input.kind)||typeof input.base64Data!=='string'||input.base64Data.length>4*MAX_BYTES/3+4||!(/^[A-Za-z0-9+/]*={0,2}$/).test(input.base64Data))throw fail('INVALID_ASSET');
 const data=Buffer.from(input.base64Data,'base64');if(data.toString('base64')!==input.base64Data)throw fail('INVALID_ASSET');if(!data.length||data.length>MAX_BYTES)throw fail('ASSET_SIZE_LIMIT');
 const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=data[0]===255&&data[1]===216&&data[2]===255,pdf=data.subarray(0,5).toString()==='%PDF-';
 const contentType=png?'image/png':jpeg?'image/jpeg':pdf?'application/pdf':null;
 if(!contentType||input.contentType!==contentType||(input.kind==='BUSINESS_PHOTO'&&pdf))throw fail('UNSUPPORTED_ASSET_FORMAT');
 return {data,contentType,sha256:createHash('sha256').update(data).digest('hex')};
}
async function route({db,sub,s3=new S3Client({})},event,input){
 if(typeof sub!=='string'||!sub||sub.includes('/'))throw fail('INVALID_SUBJECT',403);
 const life=await db.send(new GetCommand({TableName:'wizz-production-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+sub,sk:'META'},ConsistentRead:true}));if(life.Item)throw fail('ACCOUNT_CLOSING',403);
 const pk='PERSON#'+sub,get=async key=>(await db.send(new GetCommand({TableName:TABLE,Key:{pk,sk:key},ConsistentRead:true}))).Item;
 if(event.httpMethod==='GET'){
  const id=event.queryStringParameters?.assetId;if(!uuid(id))throw fail('INVALID_ASSET');const asset=await get('ASSET#'+id);if(asset?.subjectId!==sub||asset.status!=='READY'||asset.key!=='persons/'+sub+'/drafts/'+asset.draftId+'/'+asset.assetId)throw fail('ASSET_UNAVAILABLE',404);
  return {url:await getSignedUrl(s3,new GetObjectCommand({Bucket:BUCKET,Key:asset.key,ExpectedBucketOwner:OWNER,ResponseContentDisposition:asset.contentType==='application/pdf'?'attachment':'inline'}),{expiresIn:60}),expiresIn:60,contentType:asset.contentType};
 }
 if(event.httpMethod!=='POST'||Object.keys(input).some(k=>!['draftId','assetId','kind','contentType','base64Data'].includes(k)))throw fail('INVALID_ASSET');
 const file=decode(input),draft=await get('DRAFT#'+input.draftId);if(!draft||draft.subjectId!==sub||!['DRAFT','NEEDS_INFORMATION','REJECTED'].includes(draft.reviewStatus))throw fail('DRAFT_NOT_EDITABLE',409);
 const previous=await get('ASSET#'+input.assetId);if(previous&&(previous.sha256!==file.sha256||previous.kind!==input.kind||previous.draftId!==input.draftId))throw fail('ASSET_ID_CONFLICT',409);
 if(previous?.status==='PURGING')throw fail('ASSET_EXPIRED',410);
 if(previous?.status==='READY')return {assetId:previous.assetId,draft};
 const now=new Date().toISOString(),asset={pk,sk:'ASSET#'+input.assetId,subjectId:sub,assetId:input.assetId,draftId:input.draftId,kind:input.kind,status:'PENDING',key:'persons/'+sub+'/drafts/'+input.draftId+'/'+input.assetId,contentType:file.contentType,size:file.data.length,sha256:file.sha256,createdAt:previous?.createdAt||now};
 const leaseToken=randomUUID();
 const operation={pk:'ACCOUNT_OPERATION#MERCHANT#'+sub,sk:'ONBOARDING_ASSET#'+input.assetId},fence={ConditionCheck:{TableName:'wizz-production-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+sub,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}};
 await db.send(new TransactWriteCommand({TransactItems:[fence,{ConditionCheck:{TableName:TABLE,Key:{pk,sk:draft.sk},ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':draft.version}}},{Put:{TableName:TABLE,Item:asset,ConditionExpression:previous?'sha256=:hash':'attribute_not_exists(pk)',...(previous?{ExpressionAttributeValues:{':hash':file.sha256}}:{})}},{Put:{TableName:'wizz-production-AccountDeletion',Item:{...operation,leaseToken,subjectId:sub,draftId:input.draftId,expiresAt:Math.floor(Date.now()/1000)+120},ConditionExpression:'attribute_not_exists(pk) OR expiresAt<:now',ExpressionAttributeValues:{':now':Math.floor(Date.now()/1000)}}}]}));
 {
  await s3.send(new PutObjectCommand({Bucket:BUCKET,Key:asset.key,Body:file.data,ContentType:file.contentType,ServerSideEncryption:'AES256',ExpectedBucketOwner:OWNER,ChecksumSHA256:Buffer.from(file.sha256,'hex').toString('base64')}));
  const field=input.kind==='REGISTRATION_CERTIFICATE'?'registrationCertificateAssetId':'businessPhotoAssetId',next={...draft,[field]:asset.assetId,version:draft.version+1,updatedAt:new Date().toISOString()};
  await db.send(new TransactWriteCommand({TransactItems:[fence,{Delete:{TableName:'wizz-production-AccountDeletion',Key:operation,ConditionExpression:'leaseToken=:token AND expiresAt>=:now',ExpressionAttributeValues:{':token':leaseToken,':now':Math.floor(Date.now()/1000)}}},{Put:{TableName:TABLE,Item:{...asset,status:'READY'},ConditionExpression:'sha256=:hash',ExpressionAttributeValues:{':hash':file.sha256}}},{Put:{TableName:TABLE,Item:next,ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':draft.version}}}]}));return {assetId:asset.assetId,draft:next};
 }
}
module.exports={route,decode,BUCKET,MAX_BYTES};
