'use strict';
const https=require('https');
function postJson(urlString,headers,body,timeoutMs=8000){
 return new Promise((resolve,reject)=>{
  const url=new URL(urlString);if(url.protocol!=='https:'||url.username||url.password)return reject(Error('HTTPS_ENDPOINT_REQUIRED'));
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)return reject(Error('INVALID_PUSH_TIMEOUT'));
  let timer;const done=(fn,value)=>{clearTimeout(timer);fn(value);};
  const data=JSON.stringify(body),req=https.request({method:'POST',hostname:url.hostname,port:url.port||undefined,path:url.pathname+url.search,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),...headers}},res=>{
   let chunks='',bytes=0;res.on('data',d=>{bytes+=Buffer.byteLength(d);if(bytes>65536){res.destroy();req.destroy(Error('PUSH_RESPONSE_TOO_LARGE'));return;}chunks+=d;});res.on('error',e=>done(reject,e));res.on('end',()=>done(resolve,{statusCode:res.statusCode||0,body:chunks}));
  });req.on('error',e=>done(reject,e));
  timer=setTimeout(()=>req.destroy(Error('PUSH_REQUEST_TIMEOUT')),timeoutMs);timer.unref?.();
  req.setTimeout(timeoutMs,()=>req.destroy(Error('PUSH_REQUEST_TIMEOUT')));req.end(data);
 });
}
function createWaveOfferTransport({api,notificationsBase,internalKey,request=postJson}){
 return {postSocket:(connectionId,message)=>api.postToConnection({ConnectionId:connectionId,Data:JSON.stringify(message)}).promise(),
  async postPush(payload){if(!notificationsBase||!internalKey)return {skipped:true,reason:'Missing NOTIFICATIONS_API_BASE or NOTIFICATIONS_INTERNAL_KEY'};
   let timeout=8000;
   if(payload.expiresAt!==undefined){const remaining=Date.parse(payload.expiresAt)-Date.now()-250;if(!Number.isFinite(remaining)||remaining<100)throw Error('PUSH_OFFER_EXPIRED');timeout=Math.min(timeout,Math.floor(remaining));}
   return request(notificationsBase.replace(/\/$/,'')+'/push/send/wave-offer',{'x-internal-key':internalKey},payload,timeout);
  }};
}
module.exports={postJson,createWaveOfferTransport};
