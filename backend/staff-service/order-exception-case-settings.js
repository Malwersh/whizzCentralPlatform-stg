'use strict';
const {CASE_POLICY_PK:PK,validateExceptionCasePolicy:validate}=require('./order-exception-case-contract');
const PATH='/staff/settings/order-exception-cases';
async function route(ctx,actor,method,path,input){
 if(actor.scope?.allRegions!==true)throw Object.assign(Error('PERMISSION_REQUIRED'),{status:403});
 const result=await require('./operational-settings').route({...ctx,allowed:(p,k)=>p.scope?.allRegions===true&&ctx.allowed(p,k),settingsSpec:{pk:PK,validate,actionPrefix:'ORDER_EXCEPTION_CASES'}},actor,method,path.replace(PATH,'/staff/settings/account-deletion'),input);
 return {...result,effectiveFor:'NEW_CASES_AND_NEW_DECISIONS',lateSafetyAndCashReviewAlwaysAvailable:true};
}
module.exports={route,PK,PATH,validate};
