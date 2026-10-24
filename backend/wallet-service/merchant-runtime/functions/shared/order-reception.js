'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {UpdateCommand,GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const policy=require('./merchant-response-policy');
const B='WhizzMerchants_Businesses',E='staging-WalletLifecycle',A='staging-MerchantPlatform';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
function minimumOrder(b){const v=b.minimum_order;if(v==null||v===0)return null;if(!Number.isSafeInteger(v)||v<0||v>1000000000)fail('INVALID_MINIMUM_ORDER');return v;}
function projection(b){return {minimumOrderAmountIqd:minimumOrder(b),settings:policy.settings(b.orderReceptionSettings),pausedUntil:b.ordersPausedUntil??null,pauseId:b.orderPauseId??null,acceptingOrders:b.acceptingOrders===true,lastStatusUpdate:b.lastStatusUpdate??null};}
const revision=b=>createHash('sha256').update(JSON.stringify(projection(b))).digest('hex');
function view(b,canEdit){return {businessId:b.businessId,minimumOrderAmountIqd:minimumOrder(b),enabled:process.env.MERCHANT_RESPONSE_MODE==='REQUIRED',settings:policy.settings(b.orderReceptionSettings),pausedUntil:b.ordersPausedUntil??null,acceptingOrders:b.acceptingOrders===true,revision:revision(b),canEdit};}
async function execute(db,b,actor,common,input,canEdit=true){
 if(!b||!actor.subjectId||b.ownerId!==actor.ownerId||b.cognitoUserId!==actor.ownerId||b.deletionRequestId)fail('BUSINESS_UNAVAILABLE',403);
 if(input.action==='read_order_reception'){if(common.length)await db.send(new TransactWriteCommand({TransactItems:common}));return {...view(b,canEdit),notificationPolicy:await require('./notification-sound-policy').read(db)};}
 if(!canEdit)fail('PERMISSION_REQUIRED',403);
 if(process.env.MERCHANT_RESPONSE_MODE!=='REQUIRED')fail('RECEPTION_NOT_ENABLED',503);
 const allowed=input.action==='pause_orders'?['action','minutes','baseRevision']:['action','settings','baseRevision'];
 if(!['pause_orders','set_order_reception'].includes(input.action)||Object.keys(input).some(k=>!allowed.includes(k)))fail('INVALID_RECEPTION_REQUEST');
 if(input.baseRevision!==revision(b))fail('VERSION_OR_STATE_CONFLICT',409);
 const at=new Date().toISOString(),id=randomUUID(),values={':owner':actor.ownerId,':at':at,':actor':actor.subjectId};
 const names={'#owner':'ownerId','#cognito':'cognitoUserId'};
 let condition='#owner=:owner AND #cognito=:owner AND attribute_not_exists(deletionRequestId)';
 for(const [i,k] of ['orderReceptionSettings','ordersPausedUntil','orderPauseId','acceptingOrders','lastStatusUpdate','minimum_order'].entries()){
  names['#r'+i]=k;if(b[k]===undefined)condition+=' AND attribute_not_exists(#r'+i+')';else {condition+=' AND #r'+i+'=:r'+i;values[':r'+i]=b[k];}
 }
 let update='SET orderReceptionUpdatedAt=:at, orderReceptionUpdatedBy=:actor',after={};const extra=[];
 if(input.action==='set_order_reception'){
  if(!input.settings||Object.keys(input.settings).some(k=>!['autoAccept','defaultPreparationMinutes','minimumOrderAmountIqd'].includes(k)))fail('INVALID_RECEPTION_REQUEST');
  if(typeof input.settings.autoAccept!=='boolean'||!Number.isInteger(input.settings.defaultPreparationMinutes)||input.settings.defaultPreparationMinutes<5||input.settings.defaultPreparationMinutes>120)fail('INVALID_RECEPTION_REQUEST');
  const minimum=Object.prototype.hasOwnProperty.call(input.settings,'minimumOrderAmountIqd')?minimumOrder({minimum_order:input.settings.minimumOrderAmountIqd}):minimumOrder(b);
  after.minimum_order=minimum;values[':minimum']=minimum;update+=', minimum_order=:minimum';
  after.orderReceptionSettings=policy.settings(input.settings);values[':settings']=after.orderReceptionSettings;update+=', orderReceptionSettings=:settings';
 }else{
  if(![15,30,60].includes(input.minutes))fail('INVALID_PAUSE_DURATION');
  if(b.acceptingOrders!==true)fail('BRANCH_ALREADY_OFFLINE',409);
  update+=', lastStatusUpdate=:at, statusUpdatedBy=:actor';
  after={acceptingOrders:false,onlineStatus:'offline',operatingStatus:'PAUSED',ordersPausedUntil:new Date(Date.now()+input.minutes*60000).toISOString(),orderPauseId:id};
  for(const [i,[k,v]] of Object.entries(after).entries()){names['#p'+i]=k;values[':p'+i]=v;update+=', #p'+i+'=:p'+i;}
  extra.push({Put:{TableName:E,Item:{operationId:'MERCHANT_RESUME#'+b.businessId+'#'+id,kind:'MERCHANT_RESUME',branchId:b.businessId,ownerId:b.ownerId,pauseId:id,pausedAt:at,status:'PENDING',queuePartition:'MERCHANT_RESPONSE',nextAttemptAt:Math.ceil(Date.parse(after.ordersPausedUntil)/1000),createdAt:at},ConditionExpression:'attribute_not_exists(operationId)'}});
 }
 const guards=common.filter(g=>!(g.ConditionCheck?.TableName===B&&g.ConditionCheck.Key.businessId===b.businessId));
 await db.send(new TransactWriteCommand({TransactItems:[...guards,{Update:{TableName:B,Key:{businessId:b.businessId},UpdateExpression:update,ConditionExpression:condition,ExpressionAttributeNames:names,ExpressionAttributeValues:values}},...extra,{Put:{TableName:A,Item:{pk:'BRANCH#'+b.businessId,sk:'STAFF_AUDIT#RECEPTION#'+at+'#'+id,businessId:b.businessId,ownerId:b.ownerId,actorId:actor.subjectId,actorName:actor.name??'',roleName:actor.role??'',action:input.action==='pause_orders'?'ORDERS_PAUSED':'ORDER_RECEPTION_SETTINGS_CHANGED',createdAt:at,result:'SUCCEEDED',before:projection(b),after},ConditionExpression:'attribute_not_exists(pk)'}}]}));
 return view({...b,...after,...(input.action==='pause_orders'?{lastStatusUpdate:at}:{})},canEdit);
}
module.exports={execute,revision,view};
