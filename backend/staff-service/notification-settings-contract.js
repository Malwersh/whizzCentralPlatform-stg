'use strict';
const PK='OPERATIONAL_SETTINGS#ORDER_RECEPTION',PATH='/staff/settings/notification-sounds';
const CATALOG=[{id:'merchant_original',label:'صوت المطعم الأصلي',file:'first_nitification_sound.wav'},{id:'driver_original',label:'صوت السائق الأصلي',file:'driver_original.wav'},{id:'silent',label:'بدون صوت',file:null},{id:'merchant_bell',label:'جرس الطلب',file:'merchant_bell.wav'},{id:'driver_offer',label:'عرض توصيل',file:'driver_offer.wav'},{id:'online_chime',label:'جاهز للعمل',file:'online_chime.wav'},{id:'soft_chime',label:'نغمة هادئة',file:'soft_chime.wav'}];
const DEFAULTS={merchantAcceptanceSeconds:300,merchantReminderSeconds:45,merchantNewOrder:'merchant_original',driverNewOffer:'driver_original',driverGoOnline:'online_chime'};
function validate(v,catalog=CATALOG){
 const bad=()=>{throw Object.assign(Error('INVALID_NOTIFICATION_SETTINGS'),{status:400});};
 if(!v||Array.isArray(v)||Object.keys(v).length!==5||Object.keys(v).some(k=>!(k in DEFAULTS)))bad();
 if(!Number.isSafeInteger(v.merchantAcceptanceSeconds)||v.merchantAcceptanceSeconds<60||v.merchantAcceptanceSeconds>1800||!Number.isSafeInteger(v.merchantReminderSeconds)||v.merchantReminderSeconds<30||v.merchantReminderSeconds>300)bad();
 for(const k of ['merchantNewOrder','driverNewOffer','driverGoOnline'])if(!catalog.some(x=>x.id===v[k]))bad();
 return {...v};
}
async function route(ctx,actor,method,path,input){
 if(actor.scope?.allRegions!==true)throw Object.assign(Error('PERMISSION_REQUIRED'),{status:403});
 const assets=require('./notification-sound-assets');
 if(path===PATH+'/upload'&&method==='POST')return assets.upload(ctx,actor,input);
 const catalog=[...CATALOG,...await assets.list(ctx.db,ctx.table)];
 const result=await require('./operational-settings').route({...ctx,allowed:(p,k)=>p.scope?.allRegions===true&&ctx.allowed(p,k),settingsSpec:{pk:PK,validate:v=>validate(v,catalog),actionPrefix:'NOTIFICATION_SOUNDS'}},actor,method,path.replace(PATH,'/staff/settings/account-deletion'),input);
 return {...result,catalog,effectiveFor:'NEW_ORDERS_AND_NEXT_DEVICE_SETTINGS_REFRESH'};
}
module.exports={PK,PATH,CATALOG,DEFAULTS,validate,route};
