'use strict';
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
async function route(ctx,actor,input){
 const fail=(code,status=403)=>Object.assign(Error(code),{status});
 if(!actor||actor.scope?.allRegions!==true||!ctx.allowed(actor,'finance.read'))throw fail('PERMISSION_REQUIRED');
 const read=['READ','READ_PAYOUT','CAPABILITIES','LIST'].includes(input?.action);
 if(!read){if(!ctx.enrolled)throw fail('ENROLLMENT_REQUIRED');ctx.recent(ctx.claims);if(!ctx.allowed(actor,['APPROVE','RECONCILE','REJECT','RESOLVE_NOT_PAID'].includes(input?.action)?'finance.approve':'finance.request'))throw fail('PERMISSION_REQUIRED');}
 if(['REQUEST','ACK_RECEIPT','ACK_NOT_RECEIVED','REPORT_PROBLEM','CANCEL'].includes(input?.action))throw fail('DRIVER_PAYOUT_DRIVER_REQUIRED');
 const r=await(ctx.lambda||new LambdaClient({region:'us-east-1'})).send(new InvokeCommand({FunctionName:'arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept',InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({action:'staff_driver_cash_payout',accessToken:ctx.accessToken,body:input}))}));
 let out;try{if(r.FunctionError)throw Error();out=JSON.parse(Buffer.from(r.Payload).toString());}catch{throw fail('DRIVER_PAYOUT_UNAVAILABLE',503);}
 if(out.statusCode!==200||out.result?.success!==true)throw fail(out.code||'DRIVER_PAYOUT_UNAVAILABLE',[400,401,403,409,503].includes(out.statusCode)?out.statusCode:503);
 return out.result;
}
module.exports={route};
