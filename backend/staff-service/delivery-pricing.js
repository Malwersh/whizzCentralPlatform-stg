'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {randomUUID}=require('node:crypto');
const {allowed}=require('./catalog');
const engine=require('./pricing-runtime/deliveryPricing');
const workflow=require('./write-workflow');const direct=()=>workflow.direct?.()===true;
const PATH='/staff/pricing',PK='OPERATIONAL_SETTINGS#DELIVERY_PRICING';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw fail('INVALID_PRICING_REQUEST');}
function version(v){if(!Number.isSafeInteger(v)||v<0||v>=Number.MAX_SAFE_INTEGER)throw fail('INVALID_VERSION');}
function reason(r){if(typeof r!=='string'||r.trim().length<5||r.length>300)throw fail('REASON_REQUIRED');return r.trim();}
function values(input,draft=true){
 let parsed;try{parsed=engine.validatePricingRules(input);}catch(e){throw fail(e.code||'INVALID_PRICING');}
 if(Buffer.byteLength(JSON.stringify(parsed),'utf8')>160000)throw fail('PRICING_TOO_LARGE');
 if(draft&&[...parsed.deliveryRules,...parsed.driverRules].some(r=>r.status!=='DRAFT'))throw fail('DRAFT_RULES_REQUIRED');
 return parsed;
}
const view=r=>r?{version:r.version,baseVersion:r.baseVersion,values:r.values,updatedAt:r.updatedAt,requestedBy:r.requestedBy,approvedBy:r.approvedBy,reason:r.reason,publishedVersion:r.publishedVersion}:null;
async function route(ctx,actor,method,path,input){
 if(!allowed(actor,'pricing.read')||actor.scope?.allRegions!==true)throw fail('PERMISSION_REQUIRED',403);
 const read=async sk=>(await ctx.db.send(new GetCommand({TableName:ctx.table,Key:{pk:PK,sk},ConsistentRead:true}))).Item;
 const can={direct:direct(),request:allowed(actor,'pricing.request'),approve:allowed(actor,'pricing.approve'),simulate:allowed(actor,'pricing.simulate')};
 if(method==='GET'&&path===PATH)return {current:view(await read('CURRENT')),draft:view(await read('DRAFT')),can};
 if(method==='GET'&&path===PATH+'/history'){
  let cursor;const encoded=ctx.query?.cursor;
  if(encoded!==undefined){try{if(typeof encoded!=='string'||encoded.length>2048)throw Error();cursor=JSON.parse(Buffer.from(encoded,'base64url').toString());exact(cursor,['pk','sk']);if(cursor.pk!==PK||!/^VERSION#\d{12,16}$/.test(cursor.sk))throw Error();}catch(_){throw fail('INVALID_CURSOR');}}
  const result=await ctx.db.send(new QueryCommand({TableName:ctx.table,KeyConditionExpression:'pk=:pk AND begins_with(sk,:p)',ExpressionAttributeValues:{':pk':PK,':p':'VERSION#'},ConsistentRead:true,Limit:10,ScanIndexForward:false,...(cursor?{ExclusiveStartKey:cursor}:{})}));
  return {items:(result.Items||[]).map(view),nextCursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url'):null};
 }
 if(method!=='POST'||!['/draft','/publish','/simulate'].some(s=>path===PATH+s))throw fail('NOT_FOUND',404);
 if(path.endsWith('/simulate')){
  if(!can.simulate)throw fail('PERMISSION_REQUIRED',403);
  exact(input,['source','version','at','context','pickupRoute','deliveryRoute']);version(input.version);
  if(!['DRAFT','CURRENT'].includes(input.source))throw fail('INVALID_PRICING_REQUEST');
  const source=await read(input.source);if(!source||source.version!==input.version)throw fail('VERSION_OR_STATE_CONFLICT',409);
  const bundle=values(source.values,input.source==='DRAFT'&&!source.publishedVersion);
  // Simulation alone promotes draft flags in memory. No ledger, audit or policy write.
  const published=list=>list.map(r=>({...r,status:'PUBLISHED'}));
  const base={schemaVersion:1,at:input.at,context:input.context};
  try{return {simulation:true,source:input.source,version:source.version,
   delivery:engine.calculateDeliveryFee({...base,rules:published(bundle.deliveryRules),deliveryRoute:input.deliveryRoute,discount:null}),
   driver:engine.calculateDriverEarning({...base,rules:published(bundle.driverRules),pickupRoute:input.pickupRoute,deliveryRoute:input.deliveryRoute})};
  }catch(e){throw fail(e.code||'INVALID_PRICING');}
 }
 const action=path.endsWith('/draft')?'request':'approve';if(!can[action])throw fail('PERMISSION_REQUIRED',403);
 if(!ctx.enrolled)throw fail('ENROLLMENT_REQUIRED',403);ctx.recent(ctx.claims);
 exact(input,action==='request'?['baseVersion','draftVersion','values','reason']:['baseVersion','draftVersion','reason']);
 version(input.baseVersion);version(input.draftVersion);const why=reason(input.reason);
 const current=await read('CURRENT'),draft=await read('DRAFT');
 if(input.baseVersion!==(current?.version||0)||input.draftVersion!==(draft?.version||0))throw fail('VERSION_OR_STATE_CONFLICT',409);
 const now=new Date().toISOString(),id=randomUUID();
 const condition=(record)=>record?{ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':record.version}}:{ConditionExpression:'attribute_not_exists(pk)'};
 const check=(sk,record)=>({ConditionCheck:{TableName:ctx.table,Key:{pk:PK,sk},...condition(record)}});
 let result,tx;
 if(action==='request'){
  const nextValues=values(input.values);
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>k!=='status').map(k=>[k,stable(v[k])])):v;
  for(const kind of ['deliveryRules','driverRules'])for(const rule of nextValues[kind]){
   const prior=(current?.values[kind]||[]).filter(r=>r.id===rule.id),sameVersion=prior.find(r=>r.version===rule.version);
   if(sameVersion&&JSON.stringify(stable(sameVersion))!==JSON.stringify(stable(rule)))throw fail('RULE_VERSION_CONFLICT',409);
   if(!sameVersion&&rule.version!==(prior.length?Math.max(...prior.map(r=>r.version))+1:1))throw fail('RULE_VERSION_CONFLICT',409);
  }
  result={pk:PK,sk:'DRAFT',version:(draft?.version||0)+1,baseVersion:input.baseVersion,values:nextValues,requestedBy:actor.employeeId,updatedAt:now,reason:why};
  if(direct()){
   const savedDraftValues=structuredClone(nextValues);
   for(const list of [nextValues.deliveryRules,nextValues.driverRules])for(const r of list)r.status='PUBLISHED';
   const closed={...result,values:savedDraftValues,publishedVersion:input.baseVersion+1};
   result={...result,sk:'CURRENT',version:input.baseVersion+1,updatedBy:actor.employeeId,writeMode:'DIRECT'};
   tx=[ctx.guard(actor),{Put:{TableName:ctx.table,Item:result,...condition(current)}},{Put:{TableName:ctx.table,Item:closed,...condition(draft)}},{Put:{TableName:ctx.table,Item:{...result,sk:'VERSION#'+String(result.version).padStart(12,'0')},ConditionExpression:'attribute_not_exists(pk)'}},ctx.audit(actor.employeeId,'PRICING_SAVED',view(current),view(result),id)];
  }else tx=[ctx.guard(actor),check('CURRENT',current),{Put:{TableName:ctx.table,Item:result,...condition(draft)}},ctx.audit(actor.employeeId,'PRICING_DRAFT_SAVED',view(draft),view(result),id)];
 }else{
  if(!draft||draft.baseVersion!==input.baseVersion||draft.publishedVersion)throw fail('VERSION_OR_STATE_CONFLICT',409);
  if(!direct()&&draft.requestedBy===actor.employeeId)throw fail('SELF_APPROVAL_FORBIDDEN',403);
  const requester=await ctx.employee(draft.requestedBy);
  if(!requester||!allowed(requester,'pricing.request')||requester.scope?.allRegions!==true)throw fail('REQUESTER_PERMISSION_REVOKED',403);
  const bundle=values(draft.values);
  for(const list of [bundle.deliveryRules,bundle.driverRules])for(const r of list)r.status='PUBLISHED';
  result={pk:PK,sk:'CURRENT',version:input.baseVersion+1,baseVersion:input.baseVersion,values:bundle,requestedBy:requester.employeeId,approvedBy:actor.employeeId,updatedAt:now,reason:why};
  const closed={...draft,version:draft.version+1,publishedVersion:result.version};
  tx=[ctx.guard(actor),...(requester.employeeId===actor.employeeId?[]:[ctx.guard(requester)]),{Put:{TableName:ctx.table,Item:result,...condition(current)}},
   {Put:{TableName:ctx.table,Item:closed,...condition(draft)}},
   {Put:{TableName:ctx.table,Item:{...result,sk:'VERSION#'+String(result.version).padStart(12,'0')},ConditionExpression:'attribute_not_exists(pk)'}},
   ctx.audit(actor.employeeId,'PRICING_PUBLISHED',view(current),view(result),id)];
 }
 await ctx.db.send(new TransactWriteCommand({TransactItems:tx}));
 return {status:action==='request'&&!direct()?'DRAFT_SAVED':'PUBLISHED',policy:view(result)};
}
module.exports={route,values,PATH,PK};
