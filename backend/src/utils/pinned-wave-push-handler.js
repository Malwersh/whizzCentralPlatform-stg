'use strict';
const {dispatchOfferSK}=require('./dispatch-cycle-keys');
const {GetCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {pinnedWavePushData,pinnedWavePushDigest}=require('./pinned-wave-push');
const {ok,jsonResponse}=require('./http');
const fail=()=>{throw Error('PINNED_PUSH_NOT_ALLOWED');};
function createPinnedWavePushHandler({db,getMessaging,now=Date.now,env=process.env}){
 return async body=>{
  if(env.STAGE!=='staging'||env.AWS_REGION!=='us-east-1'||env.PINNED_DISPATCH_ACCOUNT_ID!=='699561669180'||env.PINNED_LEGACY_PUSH_MODE!=='REQUIRED')return jsonResponse(503,{success:false,error:'PINNED_LEGACY_PUSH_DISABLED'});
  const {dispatchMessageDigest,...payload}=body,data=pinnedWavePushData(payload,now()),key={orderId:data.orderId,SK:dispatchOfferSK({id:data.cycleId,engine:'LEGACY',...(data.dispatchKeyVersion==='2'?{keyVersion:2}:{})},data.dispatchDriverId,Number(data.waveNumber))};
  if(!/^[a-f0-9]{64}$/.test(dispatchMessageDigest||'')||env.PUSH_TOKENS_TABLE!=='WizzCentral_PushDeviceTokens_staging')return fail();
  async function get(TableName,Key,fields){const names=Object.fromEntries(fields.map((k,i)=>['#p'+i,k]));return (await db.send(new GetCommand({TableName,Key,ConsistentRead:true,ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:names}))).Item;}
  async function allowed(){
   const rollout=require('./finance-rollout').createFinanceRollout({db,env,now});await rollout.order(data.orderId,'SEND');rollout.driver(data.orderId,data.dispatchDriverId,data.driverId);
   if(Date.parse(data.expiresAt)<=now())return fail();
   const offer=await get('WaveOffers_staging',key,['orderId','SK','offerId','driverId','driverSubjectId','dispatchCycleId','legacySourceVersion','dispatchKeyVersion','responseStatus','isWinner','expiresAt','deliveryAck']);
   if(!offer||offer.SK!==key.SK||offer.orderId!==key.orderId||String(offer.dispatchKeyVersion??'')!==(data.dispatchKeyVersion??'')||offer.offerId!==data.offerId||offer.driverId!==data.dispatchDriverId||offer.driverSubjectId!==data.driverId||offer.dispatchCycleId!==data.cycleId||offer.legacySourceVersion!==1||offer.responseStatus!=='pending'||offer.isWinner!==false||offer.expiresAt!==data.expiresAt||offer.deliveryAck?.schemaVersion!==1||offer.deliveryAck?.messageDigest!==dispatchMessageDigest||offer.deliveryAck?.pushDigest!==pinnedWavePushDigest(data))return fail();
   {const job=await get('WizzDispatchJobs_staging',{orderId:data.orderId,SK:'METADATA'},['orderId','SK','dispatchCycle','status']);if(!job?.dispatchCycle||String(job.dispatchCycle.keyVersion??'')!==(data.dispatchKeyVersion??'')||job.dispatchCycle.id!==data.cycleId||job.dispatchCycle.engine!=='LEGACY'||job.status!=='searching')return fail();}
   const profile=await get('WhizzDrivers_staging',{driverId:data.dispatchDriverId},['driverId','cognitoSub','status','registrationStatus','isDeleted','deletedAt','deletionRequestId','isBanned','isSuspended']);
   if(!profile||(profile.cognitoSub??profile.driverId)!==data.driverId||!['APPROVED','VERIFIED'].includes(String(profile.status||profile.registrationStatus).toUpperCase())||profile.isDeleted===true||profile.deletedAt!=null||profile.deletionRequestId!=null||profile.isBanned===true||profile.isSuspended===true)return fail();
   for(const pk of new Set(['ACCOUNT_LIFECYCLE#DRIVER#'+data.driverId,'ACCOUNT_LIFECYCLE#DRIVER#'+data.dispatchDriverId,'BUSINESS_LIFECYCLE#MERCHANT#'+data.restaurantId]))if(await get('staging-AccountDeletion',{pk,sk:'META'},['pk','sk']))return fail();
  }
  return require('./guarded-wave-push-delivery').sendGuardedWavePush({db,getMessaging,now,env,data,allowed,echo:{offerId:data.offerId,eventId:data.eventId,cycleId:data.cycleId,driverId:data.driverId}});
 };
}
module.exports={createPinnedWavePushHandler};
