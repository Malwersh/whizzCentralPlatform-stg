'use strict';
const {validateReturnOperations:validate}=require('./return-operations-contract');
const PATH='/staff/settings/return-operations';
async function route(ctx,actor,method,path,input){if(actor.scope?.allRegions!==true)throw Object.assign(Error('PERMISSION_REQUIRED'),{status:403});const invoke=ctx.settingsRoute||require('./operational-settings').route;return invoke({...ctx,settingsSpec:{pk:'OPERATIONAL_SETTINGS#RETURN_OPERATIONS',validate,actionPrefix:'RETURN_OPERATIONS'}},actor,method,path.replace(PATH,'/staff/settings/account-deletion'),input);}
module.exports={PATH,route};
