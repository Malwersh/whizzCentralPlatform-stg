'use strict';
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const TARGET='arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept';
async function invokeCustomerCashCase(event,body,client=new LambdaClient({region:'us-east-1'})){
 const token=(event.headers?.Authorization||event.headers?.authorization||'').replace(/^Bearer\s+/i,'');
 if(!token)throw Object.assign(Error('UNAUTHORIZED'),{status:401});
 if(!body||typeof body!=='object'||Array.isArray(body)||body.workflow!=='CUSTOMER_CASH_REVIEW'||!['READ_CUSTOMER_CASH_CASE','REPORT_CASH_PAYMENT','ACKNOWLEDGE_CUSTOMER_REFUND'].includes(body.action))throw Object.assign(Error('INVALID_CASH_REVIEW'),{status:400});
 const {workflow,...input}=body;
 const r=await client.send(new InvokeCommand({FunctionName:TARGET,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({action:'customer_cash_case',accessToken:token,body:input}))}));
 if(r.FunctionError)throw Object.assign(Error('CASH_REVIEW_UNAVAILABLE'),{status:503});
 let data;try{data=JSON.parse(Buffer.from(r.Payload).toString());}catch{throw Object.assign(Error('CASH_REVIEW_UNAVAILABLE'),{status:503});}
 if(data.statusCode!==200||data.result?.success!==true||data.result.orderId!==input.orderId)throw Object.assign(Error(data.code||'CASH_REVIEW_UNAVAILABLE'),{status:[401,403,409,503].includes(data.statusCode)?data.statusCode:503});
 return data.result;
}
module.exports={invokeCustomerCashCase};
