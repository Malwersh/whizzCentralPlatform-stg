'use strict';
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const PATH='/staff/cancellation-compensation';
const fail=(code,status)=>Object.assign(Error(code),{status});
async function route(ctx,actor,method,path,input={}){
 if(path!==PATH||!['GET','POST'].includes(method))throw fail('NOT_FOUND',404);
 if(actor.scope?.allRegions!==true||!ctx.allowed(actor,'finance.read'))throw fail('PERMISSION_REQUIRED',403);
 const body=method==='GET'?{action:'READ',orderId:ctx.query?.orderId,caseKey:ctx.query?.caseKey||'CUSTOMER_CANCELLATION'}:input;
 if(method==='POST'){
  if(!ctx.enrolled)throw fail('ENROLLMENT_REQUIRED',403);ctx.recent(ctx.claims);
  if(!ctx.allowed(actor,'finance.approve'))throw fail('PERMISSION_REQUIRED',403);
  if(!['APPROVE','EXECUTE','CLOSE'].includes(body.action))throw fail('INVALID_CANCEL_COMPENSATION',400);
 }
 const r=await(ctx.lambda||new LambdaClient({region:'us-east-1'})).send(new InvokeCommand({FunctionName:'arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept',InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({action:'cancellation_compensation',accessToken:ctx.accessToken,body}))}));
 let data;try{if(r.FunctionError)throw Error();data=JSON.parse(Buffer.from(r.Payload).toString());}catch{throw fail('CANCEL_COMPENSATION_UNAVAILABLE',503);}
 if(data.statusCode!==200||data.result?.success!==true)throw fail(data.code||'CANCEL_COMPENSATION_UNAVAILABLE',[401,403,409,503].includes(data.statusCode)?data.statusCode:409);
 return data.result;
}
module.exports={route,PATH};
