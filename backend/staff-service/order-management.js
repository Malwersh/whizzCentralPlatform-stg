'use strict';
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const PATH='/staff/order-management';
const fail=(code,status)=>Object.assign(Error(code),{status});
async function route(ctx,actor,method,path,input={}){
 if(actor.scope?.allRegions!==true||!ctx.allowed(actor,'orders.read'))throw fail('PERMISSION_REQUIRED',403);
 if(path!==PATH||!['GET','POST'].includes(method))throw fail('NOT_FOUND',404);
 const body=method==='GET'?{action:'READ',orderId:ctx.query?.orderId}:input;
 if(method==='POST'){
  if(!ctx.enrolled)throw fail('ENROLLMENT_REQUIRED',403);ctx.recent(ctx.claims);
  if(!['REQUEST_CANCELLATION','CANCEL_ORDER','UNASSIGN_REDISPATCH'].includes(body.action))throw fail('INVALID_ORDER_MANAGEMENT',400);
  if(!ctx.allowed(actor,['REQUEST_CANCELLATION','CANCEL_ORDER'].includes(body.action)?'orders.cancel':'orders.assign'))throw fail('PERMISSION_REQUIRED',403);
 }
 const r=await (ctx.lambda||new LambdaClient({region:'us-east-1'})).send(new InvokeCommand({FunctionName:'arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept',InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({action:'staff_order_management',accessToken:ctx.accessToken,body}))}));
 let data;try{if(r.FunctionError)throw Error();data=JSON.parse(Buffer.from(r.Payload).toString());}catch{throw fail('ORDER_MANAGEMENT_UNAVAILABLE',503);}
 if(data.statusCode!==200||data.result?.success!==true)throw fail(data.code||'ORDER_MANAGEMENT_UNAVAILABLE',[401,403,409,503].includes(data.statusCode)?data.statusCode:409);
 return data.result;
}
module.exports={PATH,route};
