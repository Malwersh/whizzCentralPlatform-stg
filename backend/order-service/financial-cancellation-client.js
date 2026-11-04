'use strict';
const {createHash}=require('crypto');
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const TARGET='arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept';
async function invokeCustomerCancellation(event,body,client=new LambdaClient({region:'us-east-1'})){
 const token=(event.headers?.Authorization||event.headers?.authorization||'').replace(/^Bearer\s+/i,'');
 if(!token)throw Object.assign(Error('UNAUTHORIZED'),{status:401});
 const read=body.cancellationAction==='preview';
 const stable=createHash('sha256').update(JSON.stringify([body.orderId,body.requestedBy,body.reason])).digest('hex');
 const requestKey=body.idempotencyKey||[stable.slice(0,8),stable.slice(8,12),stable.slice(12,16),stable.slice(16,20),stable.slice(20,32)].join('-');
 const result=await client.send(new InvokeCommand({FunctionName:TARGET,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({action:read?'read_customer_cancellation':'request_customer_cancellation',accessToken:token,body:read?{orderId:body.orderId}:{orderId:body.orderId,reason:body.reason,idempotencyKey:requestKey}}))}));
 if(result.FunctionError)throw Object.assign(Error('CANCELLATION_UNAVAILABLE'),{status:503});
 let response;try{response=JSON.parse(Buffer.from(result.Payload).toString());}catch{throw Object.assign(Error('CANCELLATION_UNAVAILABLE'),{status:503});}
 if(response.statusCode!==200||response.result?.success!==true||response.result?.orderId!==body.orderId)throw Object.assign(Error(response.code||'CANCELLATION_UNAVAILABLE'),{status:[401,403,409,503].includes(response.statusCode)?response.statusCode:503});
 if(response.result.cancellationStatus==='REQUESTED'&&body.cancellationProtocolVersion!==1)throw Object.assign(Error('CANCELLATION_REQUESTED'),{status:409});
 return response.result;
}
module.exports={invokeCustomerCancellation};
