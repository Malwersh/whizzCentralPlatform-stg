'use strict';
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
async function read(db){
 const row=(await db.send(new GetCommand({TableName:'staging-PlatformStaff',Key:{pk:'OPERATIONAL_SETTINGS#ORDER_RECEPTION',sk:'CURRENT'},ConsistentRead:true}))).Item;
 const catalog=[];for(const id of new Set(Object.values(row?.values??{}))){if(typeof id==='string'&&/^custom_[a-f0-9]{64}$/.test(id)){const asset=(await db.send(new GetCommand({TableName:'staging-PlatformStaff',Key:{pk:'OPERATIONAL_SETTINGS#ORDER_RECEPTION',sk:'SOUND#'+id},ConsistentRead:true}))).Item;if(asset)catalog.push({id:asset.id,label:asset.label,file:asset.file,audio:asset.audio,sha256:asset.sha256,durationSeconds:asset.durationSeconds});}}
 return {catalog,version:row?.version??0,values:row?.values??{merchantAcceptanceSeconds:300,merchantReminderSeconds:45,merchantNewOrder:'merchant_original',driverNewOffer:'driver_original',driverGoOnline:'online_chime'}};
}
module.exports={read};
