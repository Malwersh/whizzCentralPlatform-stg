'use strict';
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
async function invokeCustomerOrderComplaint(event,body,client=new LambdaClient({region:'us-east-1'})){
 const token=(event.headers?.Authorization??event.headers?.authorization??'').replace(/^Bearer\s+/i,'');
 if(!token)throw Object.assign(Error('UNAUTHORIZED'),{status:401});
 if(!body||body.workflow!=='CUSTOMER_POST_DELIVERY'||!['READ','OPEN','ADD_MESSAGE','ADD_IMAGE','ACK_DECISION','APPEAL'].includes(body.action))throw Object.assign(Error('INVALID_COMPLAINT'),{status:400});
 const {workflow,...input}=body,result=await client.send(new InvokeCommand({FunctionName:'arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept',InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({action:'customer_order_complaint',accessToken:token,body:input}))}));
 if(result.FunctionError)throw Object.assign(Error('COMPLAINT_UNAVAILABLE'),{status:503});
 let r;try{r=JSON.parse(Buffer.from(result.Payload).toString());}catch{throw Object.assign(Error('COMPLAINT_UNAVAILABLE'),{status:503});}
 if(r.statusCode!==200||r.result?.success!==true||r.result.orderId!==input.orderId)throw Object.assign(Error(r.code||'COMPLAINT_UNAVAILABLE'),{status:[401,403,404,409,503].includes(r.statusCode)?r.statusCode:503});return r.result;
}
module.exports={invokeCustomerOrderComplaint};
