'use strict';
// Shared sender/receiver contract for versioned offers only. Old callers keep
// their existing adapter; no price-unit inference and no arbitrary metadata.
const fields=['dispatchKeyVersion','offerId','orderId','waveNumber','restaurantId','restaurantName','restaurantAddress','restaurantImageUrl','restaurantLat','restaurantLng','customerAddress','customerLat','customerLng','deliveryFee','tip','bonusAmount','orderTotal','holdRequiredAmount','estimatedEarnings','currency','distance','estimatedMinutes','itemsCount','sentAt','expiresAt','moneyUnit','legacySourceVersion','dispatchDriverId','driverId','cycleId','eventId','type','action','isEmergencyWave'];
const fail=()=>{throw Error('PINNED_WAVE_PUSH_INVALID');};
function pinnedWavePushData(body,at=Date.now()){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.includes(k)))return fail();
 if(body.dispatchKeyVersion!==undefined&&![2,'2'].includes(body.dispatchKeyVersion))return fail();
 const valid=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v);
 if(!['offerId','orderId','restaurantId','dispatchDriverId','driverId','cycleId','eventId'].every(k=>valid(body[k]))||body.eventId!==body.offerId||String(body.legacySourceVersion)!=='1'||body.moneyUnit!=='IQD_WHOLE'||body.currency!=='IQD'||body.type!=='new_wave_offer'||body.action!=='wave_assignment'||body.isEmergencyWave!=null&&![false,'false'].includes(body.isEmergencyWave))return fail();
 const whole=k=>{const v=body[k],n=typeof v==='number'?v:typeof v==='string'&&/^\d+$/.test(v)?Number(v):NaN;if(!Number.isSafeInteger(n)||n<0)return fail();return n;};
 const goods=whole('holdRequiredAmount'),fee=whole('deliveryFee'),tip=whole('tip');
 if(whole('bonusAmount')!==0||!Number.isSafeInteger(goods+fee+tip)||whole('orderTotal')!==goods+fee+tip||whole('estimatedEarnings')!==fee+tip||whole('waveNumber')<1||whole('waveNumber')>4||whole('itemsCount')>100||whole('estimatedMinutes')>100000)return fail();
 for(const k of ['sentAt','expiresAt'])if(typeof body[k]!=='string'||!Number.isFinite(Date.parse(body[k]))||new Date(Date.parse(body[k])).toISOString()!==body[k])return fail();
 if(Date.parse(body.sentAt)>at||Date.parse(body.expiresAt)<=at||Date.parse(body.expiresAt)<=Date.parse(body.sentAt)||Date.parse(body.expiresAt)-Date.parse(body.sentAt)>900000)return fail();
 for(const [k,bound]of [['restaurantLat',90],['customerLat',90],['restaurantLng',180],['customerLng',180],['distance',5000]])if(!['number','string'].includes(typeof body[k])||typeof body[k]==='string'&&!/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(body[k])||!Number.isFinite(Number(body[k]))||Math.abs(Number(body[k]))>bound||k==='distance'&&Number(body[k])<0)return fail();
 for(const k of ['restaurantName','restaurantAddress','customerAddress'])if(typeof body[k]!=='string'||!body[k].trim()||body[k].length>(k==='restaurantName'?160:1000))return fail();
 if(body.restaurantImageUrl){try{const u=new URL(body.restaurantImageUrl);if(u.protocol!=='https:'||u.username||u.password||body.restaurantImageUrl.length>2048)return fail();}catch{return fail();}}
 const data=Object.fromEntries(fields.filter(k=>body[k]!=null).map(k=>[k,String(body[k])]));data.isEmergencyWave='false';
 if(Buffer.byteLength(JSON.stringify(data))>3500)return fail();return data;
}
const pinnedWavePushDigest=data=>require('crypto').createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(data).sort().map(k=>[k,data[k]])))).digest('hex');
module.exports={pinnedWavePushData,pinnedWavePushDigest};
