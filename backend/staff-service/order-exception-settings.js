'use strict';
const {EXCEPTION_SETTINGS_PK:PK,EXCEPTION_SETTINGS_LIMITS:limits,validateExceptionSettings:validate}=require('./order-exception-settings-contract');
const PATH='/staff/settings/order-exceptions';
async function route(ctx,actor,method,path,input){
 if(actor.scope?.allRegions!==true)throw Object.assign(Error('PERMISSION_REQUIRED'),{status:403});
 const result=await require('./operational-settings').route({...ctx,allowed:(p,k)=>p.scope?.allRegions===true&&ctx.allowed(p,k),settingsSpec:{pk:PK,validate,actionPrefix:'ORDER_EXCEPTIONS'}},actor,method,path.replace(PATH,'/staff/settings/account-deletion'),input);
 return {...result,limits,effectiveFor:'NEW_DELIVERY_ATTEMPTS',returnExtraFeeEnabled:false,returnExtraFeeIQD:0};
}
module.exports={PK,PATH,validate,route};
