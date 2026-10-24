import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,FinancialRow as Row} from './driverFinancialTransaction';
import {setFinancialFields as set} from './financialRelease';
export async function resumeMerchantPause(db:Pick<DynamoDBDocumentClient,'send'>,row:Row,at=new Date().toISOString()){
 if(row.kind!=='MERCHANT_RESUME'||row.status!=='PENDING'||row.operationId!=='MERCHANT_RESUME#'+row.branchId+'#'+row.pauseId||!Number.isSafeInteger(row.nextAttemptAt))throw Error('INVALID_MERCHANT_RESUME');
 if(row.nextAttemptAt>Math.floor(Date.parse(at)/1000))return {deferred:true};
 const ek={operationId:row.operationId},bk={businessId:row.branchId},b=await strongGet(db,'WhizzMerchants_Businesses',bk);
 const fields=['businessId','ownerId','cognitoUserId','orderPauseId','ordersPausedUntil','acceptingOrders','lastStatusUpdate','status','isActive','onboardingSchemaVersion','onboardingComplete','platformSuspended','ordersBlocked','deletionRequestId'];
 const ops:Row[]=[],finish=(result:string)=>set(exactCheck('staging-WalletLifecycle',ek,row),{status:'DONE',result,completedAt:at,queuePartition:'MERCHANT_RESPONSE_DONE',nextAttemptAt:0});
 let allowed=!!b&&b.ownerId===row.ownerId&&b.cognitoUserId===row.ownerId&&b.orderPauseId===row.pauseId&&b.acceptingOrders===false&&b.lastStatusUpdate===row.pausedAt&&Date.parse(b.ordersPausedUntil)<=Date.parse(at)&&!b.deletionRequestId&&b.isActive===true&&['approved','active'].includes(b.status)&&(!b.onboardingSchemaVersion||b.onboardingComplete===true)&&b.platformSuspended!==true&&b.ordersBlocked!==true;
 for(const pk of ['BUSINESS_LIFECYCLE#MERCHANT#'+row.branchId,'ACCOUNT_LIFECYCLE#MERCHANT#'+row.ownerId]){
  const k={pk,sk:'META'},marker=await strongGet(db,'staging-AccountDeletion',k);
  if(marker)allowed=false;
  else ops.push({ConditionCheck:{TableName:'staging-AccountDeletion',Key:k,ConditionExpression:'attribute_not_exists(pk)'}});
 }
 if(allowed){const update=set(exactCheck('WhizzMerchants_Businesses',bk,b!,fields),{acceptingOrders:true,onlineStatus:'online',operatingStatus:'AVAILABLE',lastStatusUpdate:at,statusUpdatedBy:'MERCHANT_RESPONSE_WORKER',statusSource:'pause_auto_resume'});
  update.Update.UpdateExpression+=' REMOVE #pauseUntil, #pauseId';Object.assign(update.Update.ExpressionAttributeNames,{'#pauseUntil':'ordersPausedUntil','#pauseId':'orderPauseId'});ops.push(update,finish('RESUMED'));
 }else{if(b)ops.push(exactCheck('WhizzMerchants_Businesses',bk,b,fields));ops.push(finish('SKIPPED_STATE_CHANGED'));}
 await db.send(new TransactWriteCommand({TransactItems:ops as any}));return {resumed:allowed};
}
