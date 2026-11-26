'use strict';
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('./catalog');
const vehicles=require('../shared/driver-vehicles-308');
async function route(ctx,actor,method,path,input){
 const match=path.match(/^\/staff\/drivers\/([A-Za-z0-9_-]{1,100})\/vehicles$/);
 if(!match||!['GET','POST'].includes(method))throw Object.assign(Error('NOT_FOUND'),{status:404});
 if(!allowed(actor,method==='POST'?'drivers.review':'drivers.documents.read'))throw Object.assign(Error('PERMISSION_REQUIRED'),{status:403});
 if(method==='POST'&&input?.action==='REVIEW_ACCOUNT'&&input.decision==='SUSPENDED'&&!allowed(actor,'drivers.suspend'))throw Object.assign(Error('PERMISSION_REQUIRED'),{status:403});
 return vehicles.operation({...ctx,GetCommand,TransactWriteCommand,liveTable:'WizzDriverLiveState_staging',bucket:process.env.DRIVER_DOCUMENTS_BUCKET||process.env.DRIVER_DOCS_BUCKET,
  authorize(p){if(!allowed(actor,method==='POST'?'drivers.review':'drivers.documents.read',p.work_region_id))throw Object.assign(Error('REGION_FORBIDDEN'),{status:403});},
  ...(method==='POST'?{lifecycleGuard:{ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+match[1],sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}},staffGuard:ctx.guard(actor),audit:(action,before,after)=>ctx.audit(actor.employeeId,action,before,after,ctx.id())}:{})
 },{driverId:match[1],actorId:actor.employeeId,staff:true,body:method==='POST'?input:null});
}
module.exports={route};
