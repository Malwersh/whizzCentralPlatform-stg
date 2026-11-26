'use strict';

const {GetCommand,QueryCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('./catalog');

const queue='COMMERCIAL_FUNDING_QUEUE';
const prefix='FUNDING#';
const statuses=new Set(['WAITING','READY','APPROVED','EXPIRED']);
const sources=new Set(['MERCHANT','PLATFORM']);
const isId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(value);
const reject=(code,status=400)=>{throw Object.assign(Error(code),{status});};
const get=async(db,TableName,Key)=>(await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;
const approved=b=>b?.status==='approved'&&!b.isDeleted&&!b.deletedAt&&!b.deletionRequestId;
const summary=b=>({id:b.businessId,name:b.businessName||b.name||'فرع مسجّل'});

function pointer(TableName,draft) {
  const {id,ownerId,businessIds:[businessId],values:{campaignId,source}}=draft;
  return {Put:{TableName,Item:{pk:queue,sk:prefix+id,id,businessId,ownerId,campaignId,source},
    ConditionExpression:'attribute_not_exists(pk) OR (businessId=:branch AND ownerId=:owner AND campaignId=:campaign AND #source=:source)',
    ExpressionAttributeNames:{'#source':'source'},
    ExpressionAttributeValues:{':branch':businessId,':owner':ownerId,':campaign':campaignId,':source':source}}};
}

function listOptions(input,allowedKeys) {
  if (!input||Object.keys(input).some(key=>!allowedKeys.includes(key))||
      ['businessId','campaignId'].some(key=>input[key]!==undefined&&!isId(input[key]))||
      (input.source!==undefined&&!sources.has(input.source))||
      (input.status!==undefined&&!statuses.has(input.status))) reject('INVALID_COMMERCIAL_REQUEST');
}

function cursor(raw, scope, validate) {
  if (raw===undefined) return undefined;
  try {
    if (typeof raw!=='string'||raw.length>1100||!/^[\w-]+$/.test(raw)) throw Error();
    const [expected,key]=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
    if (JSON.stringify(expected)!==JSON.stringify(scope)||!validate(key)) throw Error();
    return key;
  } catch { return reject('INVALID_CURSOR'); }
}
const encode=(scope,key)=>key ? Buffer.from(JSON.stringify([scope,key])).toString('base64url') : null;

async function proveStaff(ctx,actor) {
  try {
    await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor)]}));
  } catch (error) {
    if (error.name==='TransactionCanceledException') reject('PERMISSION_REQUIRED',403);
    throw error;
  }
}

async function branches(ctx,actor,input) {
  listOptions(input,['view','businessId','cursor']);
  const {db,commercialTables:{businesses}}=ctx;
  if (input.businessId!==undefined) {
    if (input.cursor!==undefined) reject('INVALID_CURSOR');
    const branch=await get(db,businesses,{businessId:input.businessId});
    if (!approved(branch)) reject('BUSINESS_UNAVAILABLE',404);
    await proveStaff(ctx,actor);
    return {items:[summary(branch)],nextCursor:null};
  }
  const key=cursor(input.cursor,'funding-branches',isId);
  const page=await db.send(new ScanCommand({
    TableName:businesses,Limit:50,Select:'SPECIFIC_ATTRIBUTES',
    ProjectionExpression:'businessId,businessName,#name,#status,deletedAt,isDeleted,deletionRequestId',
    ExpressionAttributeNames:{'#name':'name','#status':'status'},
    ...(key&&{ExclusiveStartKey:{businessId:key}}),
  }));
  await proveStaff(ctx,actor);
  return {items:(page.Items||[]).filter(approved).map(summary),
    nextCursor:encode('funding-branches',page.LastEvaluatedKey?.businessId)};
}

async function list(ctx,actor,input) {
  listOptions(input,['view','businessId','status','campaignId','source','cursor']);
  if ((input.campaignId===undefined)!==(input.source===undefined)) reject('INVALID_COMMERCIAL_REQUEST');
  const {db,commercialTables:{platform,staff,businesses},discountTables}=ctx;
  const scope=[input.businessId??null,input.campaignId??null,input.source??null,input.status??null];
  const last=cursor(input.cursor,scope,key=>typeof key==='string'&&key.startsWith(prefix)&&isId(key.slice(prefix.length)));
  const filters=[],values={':pk':queue};
  for (const name of ['businessId','campaignId','source']){
    if (input[name]===undefined) continue;
    values[':'+name]=input[name];
    filters.push((name==='source'?'#source':name)+'=:'+name);
  }
  const page=await db.send(new QueryCommand({TableName:platform,KeyConditionExpression:'pk=:pk',
    ExpressionAttributeValues:values,ConsistentRead:true,Limit:25,
    ...(input.source&&{ExpressionAttributeNames:{'#source':'source'}}),
    ...(filters.length&&{FilterExpression:filters.join(' AND ')}),
    ...(last&&{ExclusiveStartKey:{pk:queue,sk:last}}),
  }));
  const now=Date.parse(ctx.now());
  const items=await Promise.all((page.Items||[]).map(async entry=>{
    const {id,businessId,ownerId,campaignId,source}=entry;
    if (![id,businessId,campaignId].every(isId)||!sources.has(source)) return null;
    const pk='DISCOUNT_FUNDING#'+id;
    const [branch,draft]=await Promise.all([
      get(db,businesses,{businessId}),get(db,staff,{pk,sk:'DRAFT'}),
    ]);
    if (!approved(branch)||branch.ownerId!==ownerId||branch.cognitoUserId!==ownerId||
        draft?.kind!=='FUNDING'||draft.ownerId!==ownerId||draft.organizationId!==branch.organizationId||
        draft.businessIds?.length!==1||draft.businessIds[0]!==businessId||
        draft.values?.campaignId!==campaignId||draft.values.source!==source) return null;
    const expired=Date.parse(draft.values.effectiveTo)<=now;
    const consent=draft.publishedVersion||expired ? null : await get(db,staff,{pk,sk:'CONSENT#'+draft.version});
    const accepted=consent?.hash===draft.hash;
    const status=expired?'EXPIRED':draft.publishedVersion?'APPROVED':accepted?'READY':'WAITING';
    if (input.status&&status!==input.status) return null;
    const campaign=await get(db,discountTables[source],{discountId:campaignId});
    const {version,baseVersion,hash,values:terms,createdAt,publishedVersion}=draft;
    return {id,branch:summary(branch),campaignLabel:campaign?.title||campaign?.name||campaign?.code||'عرض محفوظ',
      status,acceptedRole:accepted?(consent.acceptedRole||'OWNER'):null,
      draft:{id,version,baseVersion,hash,values:terms,createdAt,publishedVersion:publishedVersion||null}};
  }));
  await proveStaff(ctx,actor);
  return {items:items.filter(Boolean),nextCursor:encode(scope,page.LastEvaluatedKey?.sk),
    can:{fundingRequest:allowed(actor,'commercial.funding.request'),fundingApprove:allowed(actor,'commercial.funding.approve')}};
}

module.exports={pointer,list,branches};
