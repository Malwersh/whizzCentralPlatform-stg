'use strict';
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
const {DEFAULTS,CATALOG,validate}=require('../../staff-service/notification-settings-contract');
async function readPolicy(db){
 const row=(await db.send(new GetCommand({TableName:'staging-PlatformStaff',Key:{pk:'OPERATIONAL_SETTINGS#ORDER_RECEPTION',sk:'CURRENT'},ConsistentRead:true}))).Item;
 const values=row?.values??{...DEFAULTS};const custom=await require('../../staff-service/notification-sound-assets').selected(db,'staging-PlatformStaff',values);const catalog=[...CATALOG,...custom];return {version:row?.version??0,values:validate(values,catalog),catalog};
}
function soundFile(policy,key,enabled=true,ready=[]){if(!enabled)return null;const id=policy.values[key];const entry=policy.catalog.find(v=>v.id===id);if(entry&&(id.startsWith('custom_')||id.endsWith('_original'))&&!ready.includes(id)){const fallback=key==='merchantNewOrder'?'merchant_original':'driver_original';return ready.includes(fallback)?policy.catalog.find(v=>v.id===fallback)?.file??'default':'default';}return entry?entry.file:'default';}
module.exports={readPolicy,soundFile};
