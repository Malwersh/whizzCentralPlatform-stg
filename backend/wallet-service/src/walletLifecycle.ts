import {financialStaff,staffGuard} from './staffAccess';
import {TransactWriteCommand} from './db';
import {fundingError} from './fundingService';
import {randomUUID} from 'crypto';
import {docClient,TABLES,GetCommand,QueryCommand,ScanCommand,UpdateCommand} from './db';
import {HoldService} from './holdService';
export function lifecycleDecision(hold:any,order:any){
 if(hold.financialSchemaVersion!==undefined)return {action:'REVIEW',reason:'FINANCIAL_HOLD_REQUIRES_ORDER_SETTLEMENT'};
 if(hold.status==='RELEASED'&&['delivered','completed'].includes(order?.status))return {action:'REVIEW',reason:'DELIVERED_BUT_RELEASED'};
 if(hold.status==='CAPTURED'&&/^(canceled|cancelled)(_|$)/.test(order?.status||''))return {action:'REVIEW',reason:'CANCELLED_BUT_CAPTURED'};
 if(hold.status==='RELEASED'||hold.status==='CAPTURED')return {action:'DONE',result:hold.status};
 if(hold.status!=='ACTIVE')return {action:'REVIEW',reason:'UNKNOWN_HOLD_STATUS'};
 if(!order)return {action:'REVIEW',reason:'ORDER_NOT_FOUND'};
 const owner=hold.walletId.replace(/^WALLET#DRIVER#/,'');
 if(['delivered','completed'].includes(order.status))return order.driverId===owner&&(order.holdId===hold.holdId||!order.holdId)?{action:'CAPTURE'}:{action:'REVIEW',reason:'DELIVERY_HOLD_MISMATCH'};
 if(/^(canceled|cancelled)(_|$)/.test(order.status))return {action:'RELEASE'};
 if(order.status==='reassigning'&&order.driverId!==owner)return {action:'RELEASE'};
 if(order.walletReleaseIntents?.[hold.holdId])return order.driverId===owner?{action:'REVIEW',reason:'RELEASE_WHILE_ASSIGNED'}:{action:'RELEASE'};
 if(order.driverId===owner&&(!order.holdId||order.holdId===hold.holdId))return {action:'MONITOR'};
 if(order.driverId&&order.driverId!==owner)return {action:'REVIEW',reason:'ASSIGNMENT_HOLD_MISMATCH'};
 if(Date.now()-Date.parse(hold.createdAt)>300000)return {action:'REVIEW',reason:'UNLINKED_HOLD'};
 return {action:'MONITOR'};
}
export function orderGuard(order:any){
 const names:any={'#status':'status'},values:any={':status':order.status},checks=['#status = :status'];
 for(const field of ['updatedAt','driverId','holdId']){names['#'+field]=field;if(order[field]===undefined)checks.push('attribute_not_exists(#'+field+')');else{values[':'+field]=order[field];checks.push('#'+field+' = :'+field);}}
 return {ConditionCheck:{TableName:process.env.ORDERS_TABLE,Key:{PK:order.PK,SK:order.SK},ConditionExpression:checks.join(' AND '),ExpressionAttributeNames:names,ExpressionAttributeValues:values}};
}
export async function processLifecycle(job:any,now=Math.floor(Date.now()/1000)){
 if(job.integrationSchemaVersion!=null||/^COD_.*_OUTBOX$/.test(job.kind||''))return;
 const table=process.env.WALLET_LIFECYCLE_TABLE!;const key={operationId:job.operationId};const token=randomUUID();
 try{await docClient.send(new UpdateCommand({TableName:table,Key:key,UpdateExpression:'SET leaseToken = :token, leaseUntil = :until',ConditionExpression:'#s <> :done AND #s <> :review AND nextAttemptAt <= :now AND (attribute_not_exists(leaseUntil) OR leaseUntil < :now)',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':token':token,':until':now+90,':now':now,':done':'COMPLETED',':review':'REVIEW_REQUIRED'}}));}catch(e:any){if(e.name==='ConditionalCheckFailedException')return;throw e;}
 async function finish(status:string,action:string,extra:any={}){const values:any={':token':token,':partition':'PENDING',':s':status,':a':action,':next':now+(status==='RETRY'?Math.min(300,30*Math.pow(2,Math.min(job.attempts||0,4))):60),':time':new Date().toISOString()},names:any={'#s':'status','#a':'action'};let update='SET queuePartition = :partition, #s = :s, #a = :a, nextAttemptAt = :next, updatedAt = :time';for(const [field,value] of Object.entries(extra)){names['#'+field]=field;values[':'+field]=value;update+=', #'+field+' = :'+field;}if(['COMPLETED','REVIEW_REQUIRED'].includes(status)){update=update.replace('queuePartition = :partition, ','');delete values[':partition'];}await docClient.send(new UpdateCommand({TableName:table,Key:key,UpdateExpression:update+' REMOVE leaseToken, leaseUntil'+(['COMPLETED','MONITORING'].includes(status)?', lastError':'')+(['COMPLETED','REVIEW_REQUIRED'].includes(status)?', queuePartition':''),ConditionExpression:'leaseToken = :token',ExpressionAttributeNames:names,ExpressionAttributeValues:values}));}
 try{
  const {Item:storedHold}=await docClient.send(new GetCommand({TableName:TABLES.HOLDS,Key:{orderId:job.orderId,sk:'HOLD'},ConsistentRead:true}));
  const hold = ['CAPTURED','RELEASED'].includes(job.result)?{...job,holdId:job.operationId,status:job.result}:storedHold;
  if(!hold||hold.holdId!==job.operationId){await finish('REVIEW_REQUIRED','REVIEW',{lastError:'HOLD_REPLACED_OR_MISSING'});return;}
  const {Item:order}=await docClient.send(new GetCommand({TableName:process.env.ORDERS_TABLE,Key:{PK:'ORDER#'+job.orderId,SK:'META'},ConsistentRead:true}));const decision=lifecycleDecision(hold,order);
  if(decision.action==='REVIEW'){await finish('REVIEW_REQUIRED','REVIEW',{lastError:decision.reason});return;}
  if(decision.action==='MONITOR'){
   if(!order?.holdId&&order?.driverId===hold.walletId.replace(/^WALLET#DRIVER#/,'')){
    const snapshot=orderGuard(order).ConditionCheck;
    await docClient.send(new UpdateCommand({TableName:snapshot.TableName,Key:snapshot.Key,UpdateExpression:'SET #holdId = :newHold, holdStatus = :active, holdAmount = :amount, pricingFrozen = :frozen, walletFinancialStatus = :active',ConditionExpression:snapshot.ConditionExpression,ExpressionAttributeNames:snapshot.ExpressionAttributeNames,ExpressionAttributeValues:{...snapshot.ExpressionAttributeValues,':newHold':hold.holdId,':active':'ACTIVE',':amount':hold.amount,':frozen':true}}));
   }
   await finish('MONITORING','MONITOR');return;
  }
  if(decision.action==='CAPTURE'||decision.action==='RELEASE'){
   const service=new HoldService();const guard=orderGuard(order);
   if(decision.action==='CAPTURE')await service.captureHold({holdId:hold.holdId,actualAmount:hold.amount,reason:'Delivered order settlement retry'},guard);
   else await service.releaseHold({holdId:hold.holdId,reason:'Cancelled/unassigned order release retry'},guard);
  }
  // Synchronize order only if it still references this exact hold; never replace a newer assignment.
  const result=decision.action==='DONE'?decision.result:decision.action==='CAPTURE'?'CAPTURED':'RELEASED';
  if(order&&order.holdId===hold.holdId){try{await docClient.send(new UpdateCommand({TableName:process.env.ORDERS_TABLE,Key:{PK:order.PK,SK:order.SK},UpdateExpression:'SET holdStatus = :s, walletFinancialStatus = :s',ConditionExpression:'holdId = :id',ExpressionAttributeValues:{':s':result,':id':hold.holdId}}));}catch(e:any){if(e.name!=='ConditionalCheckFailedException')throw e;}}
  if(order&&order.walletPendingHoldId===hold.holdId){try{await docClient.send(new UpdateCommand({TableName:process.env.ORDERS_TABLE,Key:{PK:order.PK,SK:order.SK},UpdateExpression:order.holdId?'REMOVE walletPendingHoldId':'SET walletFinancialStatus = :s REMOVE walletPendingHoldId',ConditionExpression:order.holdId?'walletPendingHoldId = :id':'walletPendingHoldId = :id AND attribute_not_exists(holdId)',ExpressionAttributeValues:{':id':hold.holdId,...(order.holdId?{}:{':s':result})}}));}catch(e:any){if(e.name!=='ConditionalCheckFailedException')throw e;}}
  await finish('COMPLETED',decision.action==='DONE'?'SYNC':decision.action,{result,completedAt:new Date().toISOString()});
 }catch(e:any){await finish('RETRY',job.action==='MONITOR'?'RECONCILE':job.action,{attempts:(job.attempts||0)+1,lastError:e.code||e.name||'OPERATION_FAILED'});}
}
export async function lifecycleWorker(){
 if(!process.env.WALLET_LIFECYCLE_TABLE||!process.env.ORDERS_TABLE)throw Error('Lifecycle tables are required');
 let cursor;let processed=0;for(let page=0;page<2;page++){
  const result:any=await docClient.send(new QueryCommand({TableName:process.env.WALLET_LIFECYCLE_TABLE,IndexName:'ByDue',KeyConditionExpression:'queuePartition = :pending AND nextAttemptAt <= :now',ExpressionAttributeValues:{':pending':'PENDING',':now':Math.floor(Date.now()/1000)},ExclusiveStartKey:cursor,Limit:25}));
  for(const job of result.Items||[])await processLifecycle(job);
  processed+=(result.Items||[]).length;cursor=result.LastEvaluatedKey;if(!cursor)break;
 }
 return {processed};
}

export async function listLifecycle(cursor?:string){let start;if(cursor){try{start=JSON.parse(Buffer.from(cursor,'base64url').toString());if(cursor.length>1024||Object.keys(start).length!==1||typeof start.operationId!=='string')throw Error();}catch(_){throw Error('INVALID_CURSOR');}}const result:any=await docClient.send(new ScanCommand({TableName:process.env.WALLET_LIFECYCLE_TABLE,Limit:100,ExclusiveStartKey:start}));return {operations:result.Items||[],nextCursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url'):null};}

export async function retryLifecycle(actor:string,authTime:number,input:any){
 if(!Number.isInteger(authTime)||Math.floor(Date.now()/1000)-authTime>300||authTime>Math.floor(Date.now()/1000)+30)throw fundingError('أعد تسجيل الدخول لتأكيد إعادة المحاولة','REAUTH_REQUIRED',403);
 if(typeof input.operationId!=='string'||input.operationId.length>120||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300)throw fundingError('أدخل مرجع العملية وسبب المراجعة','INVALID_RETRY',400);
 const staff=await financialStaff(actor,'finance.approve');const now=new Date().toISOString();
 await docClient.send(new TransactWriteCommand({TransactItems:[...(staff?[staffGuard(staff)]:[]),{Update:{TableName:process.env.WALLET_LIFECYCLE_TABLE,Key:{operationId:input.operationId},UpdateExpression:'SET queuePartition = :partition, #s = :retry, nextAttemptAt = :zero, requestedBy = :actor, retryReason = :reason, updatedAt = :now REMOVE leaseToken, leaseUntil',ConditionExpression:'#s = :review OR (#s = :retry AND (attribute_not_exists(leaseUntil) OR leaseUntil < :time))',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':partition':'PENDING',':retry':'RETRY',':review':'REVIEW_REQUIRED',':zero':0,':actor':actor,':reason':input.reason.trim(),':now':now,':time':Math.floor(Date.now()/1000)}}},{Put:{TableName:TABLES.AUDIT_LOG,Item:{datePartition:'date#'+now.slice(0,10).replace(/-/g,''),sk:now+'#'+randomUUID(),action:'LIFECYCLE_RETRY_REQUESTED',actorId:actor,operationId:input.operationId,reason:input.reason.trim()},ConditionExpression:'attribute_not_exists(sk)'}}]}));return {scheduled:true};
}
