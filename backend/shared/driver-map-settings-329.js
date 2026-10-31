'use strict';
const PK='OPERATIONAL_SETTINGS#DRIVER_MAP_TOOLS';
const DEFAULTS={customerServicePhone:'+9647831367435',heatEnabled:true,busyMinimumReady:3,refreshSeconds:40};
function validate(v){if(!v||Array.isArray(v)||Object.keys(v).sort().join(',')!==Object.keys(DEFAULTS).sort().join(',')||!/^\+9647\d{9}$/.test(v.customerServicePhone)||typeof v.heatEnabled!=='boolean'||!Number.isSafeInteger(v.busyMinimumReady)||v.busyMinimumReady<2||v.busyMinimumReady>20||!Number.isSafeInteger(v.refreshSeconds)||v.refreshSeconds<30||v.refreshSeconds>120)throw Object.assign(Error('INVALID_DRIVER_MAP_SETTINGS'),{status:400});return {...v};}
async function readPolicy(db,GetCommand){const row=(await db.send(new GetCommand({TableName:'staging-PlatformStaff',Key:{pk:PK,sk:'CURRENT'},ConsistentRead:true}))).Item;if(!row||!Number.isSafeInteger(row.version))throw Error('MAP_SETTINGS_UNAVAILABLE');return {...validate(row.values),version:row.version};}
module.exports={PK,DEFAULTS,validate,readPolicy};
