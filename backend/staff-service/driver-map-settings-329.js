'use strict';
const {PK,validate}=require('../shared/driver-map-settings-329');
const PATH='/staff/settings/driver-map';
async function route(ctx,actor,method,path,input){if(actor.scope?.allRegions!==true)throw Object.assign(Error('PERMISSION_REQUIRED'),{status:403});return (ctx.settingsRoute||require('./operational-settings').route)({...ctx,allowed:(p,k)=>p.scope?.allRegions===true&&ctx.allowed(p,k),settingsSpec:{pk:PK,validate,actionPrefix:'DRIVER_MAP_TOOLS'}},actor,method,path.replace(PATH,'/staff/settings/account-deletion'),input);}
module.exports={route};
