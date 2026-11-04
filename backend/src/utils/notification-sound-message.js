'use strict';
function applySound(message,file,prefix){
 const m=structuredClone(message);m.android??={};m.android.notification??={};m.apns??={};m.apns.payload??={};m.apns.payload.aps??={};
 if(file){m.android.notification.sound=file.replace(/\.(wav|mp3)$/,'');m.apns.payload.aps.sound=file;}else{delete m.android.notification.sound;delete m.apns.payload.aps.sound;}
 m.android.notification.channelId=prefix+'_'+(file?file.replace(/\.(wav|mp3)$/,''):'silent');
 return m;
}
module.exports={applySound};
