'use strict';
const https=require('https');
function postJson(urlString,headers,body,timeoutMs=2500){
 return new Promise((resolve,reject)=>{
  const url=new URL(urlString);if(url.protocol!=='https:'||url.username||url.password)return reject(Error('HTTPS_ENDPOINT_REQUIRED'));
  const data=JSON.stringify(body),req=https.request({method:'POST',hostname:url.hostname,port:url.port||undefined,path:url.pathname+url.search,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),...headers}},res=>{
   let chunks='',bytes=0;res.on('data',d=>{bytes+=Buffer.byteLength(d);if(bytes>65536){res.destroy();req.destroy(Error('PUSH_RESPONSE_TOO_LARGE'));return;}chunks+=d;});res.on('error',reject);res.on('end',()=>resolve({statusCode:res.statusCode||0,body:chunks}));
  });req.on('error',reject);req.setTimeout(timeoutMs,()=>req.destroy(Error('request timeout')));req.end(data);
 });
}
function createWaveOfferTransport({api,notificationsBase,internalKey,request=postJson}){
 return {postSocket:(connectionId,message)=>api.postToConnection({ConnectionId:connectionId,Data:JSON.stringify(message)}).promise(),
  async postPush(payload){if(!notificationsBase||!internalKey)return {skipped:true,reason:'Missing NOTIFICATIONS_API_BASE or NOTIFICATIONS_INTERNAL_KEY'};
   return request(notificationsBase.replace(/\/$/,'')+'/push/send/wave-offer',{'x-internal-key':internalKey},payload,3000);
  }};
}
module.exports={postJson,createWaveOfferTransport};
