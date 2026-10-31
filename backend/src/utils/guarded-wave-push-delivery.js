'use strict';
const {GetCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {ok}=require('./http');
const fail=()=>{throw Error('GUARDED_WAVE_PUSH_NOT_ALLOWED');};
async function sendGuardedWavePush({db,getMessaging,now,env,data,allowed,echo}){
 async function get(TableName,Key,fields){const names=Object.fromEntries(fields.map((k,i)=>['#p'+i,k]));return (await db.send(new GetCommand({TableName,Key,ConsistentRead:true,ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:names}))).Item;}
  await allowed();
  let cursor,tokens=[],pages=0;const cursors=new Set();
  do{
   if(++pages>5)return fail();
   const r=await db.send(new QueryCommand({TableName:env.PUSH_TOKENS_TABLE,IndexName:'SubjectIdIndex',KeyConditionExpression:'subjectId=:sid',ExpressionAttributeValues:{':sid':data.driverId},Limit:100,ExclusiveStartKey:cursor}));
   if(!Array.isArray(r.Items??[])||r.Items?.length>100)return fail();
   for(const row of r.Items||[])if(row.app==='driver'&&row.env==='staging'&&row.subjectId===data.driverId&&typeof row.token==='string'&&row.token.length>0&&row.token.length<=4096)tokens.push(row.token);
   cursor=r.LastEvaluatedKey;if(cursor){const s=JSON.stringify(cursor);if(cursors.has(s))return fail();cursors.add(s);}
  }while(cursor);
  tokens=[...new Set(tokens)];if(tokens.length>500)return fail();
  if(!tokens.length)return ok({...echo,success:false,tokensCount:0,successCount:0});
  const messaging=await getMessaging(),eligible=[],readyByToken=new Map();
  // Strongly hydrate after the eventual index and Firebase initialization.
  for(const token of tokens){const r=await get(env.PUSH_TOKENS_TABLE,{token},['token','subjectId','app','env','ttl','soundReady','soundEnabled']);if(r?.token===token&&r.subjectId===data.driverId&&r.app==='driver'&&r.env==='staging'&&Number.isSafeInteger(r.ttl)&&r.ttl>Math.floor(now()/1000)){eligible.push(token);readyByToken.set(token,r);}}
  if(!eligible.length)return ok({...echo,success:false,tokensCount:0,successCount:0});
  await allowed();
  const message={tokens:eligible,notification:{title:'عرض توصيل جديد',body:data.restaurantName?`من ${data.restaurantName} - افتح التطبيق للقبول`:'افتح التطبيق لمراجعة العرض والقبول'},data,
   android:{collapseKey:`wave-offer:${data.offerId}`,priority:'high',ttl:Math.max(0,Date.parse(data.expiresAt)-now()),notification:{sound:'default'}},
   apns:{headers:{'apns-priority':'10','apns-push-type':'alert','apns-collapse-id':require('crypto').createHash('sha256').update(data.offerId).digest('hex'),'apns-expiration':String(Math.floor(Date.parse(data.expiresAt)/1000))},payload:{aps:{sound:'default','content-available':1,'mutable-content':1,category:'new_wave_offer'},type:data.type,action:data.action,driverId:data.driverId,offerId:data.offerId,orderId:data.orderId,cycleId:data.cycleId,eventId:data.eventId}}};
  if(Buffer.byteLength(JSON.stringify({notification:message.notification,data:message.data,apns:message.apns.payload}))>4096)return fail();
  const policy=await require('../handlers/notification-sound-policy').readPolicy(db);
  const groups=new Map();for(const token of eligible){const row=readyByToken.get(token),file=require('../handlers/notification-sound-policy').soundFile(policy,'driverNewOffer',row?.soundEnabled!==false,row?.soundReady??[]),key=file??'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(token);}
  const r={successCount:0};for(const [file,tokens] of groups){await allowed();const sent=await messaging.sendEachForMulticast(require('./notification-sound-message').applySound({...message,tokens},file||null,'driver_offers'));r.successCount+=sent.successCount;}
  if(!Number.isSafeInteger(r.successCount)||r.successCount<0||r.successCount>eligible.length)return fail();
  // Never return provider tokens or free-text errors to the caller/log.
  return ok({...echo,success:r.successCount>0,tokensCount:eligible.length,successCount:r.successCount,failureCount:eligible.length-r.successCount});
}
module.exports={sendGuardedWavePush};
