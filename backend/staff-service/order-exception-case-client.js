'use strict';
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const TARGET='arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept';
async function invoke(accessToken,body,client=new LambdaClient({region:'us-east-1'})){
 if(typeof accessToken!=='string'||!accessToken)throw Object.assign(Error('UNAUTHORIZED'),{status:401});
 let action='exception_case_admin',input=body;
 if(body?.caseKey==='CUSTOMER_CASH_REVIEW'){
  const {caseKey,caseId,...rest}=body;input=rest;action='staff_cash_case';
 }
 const r=await client.send(new InvokeCommand({FunctionName:TARGET,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({action,accessToken,body:input}))}));
 if(r.FunctionError)throw Object.assign(Error('EXCEPTION_CASE_UNAVAILABLE'),{status:503});
 let data;try{data=JSON.parse(Buffer.from(r.Payload).toString());}catch{throw Object.assign(Error('EXCEPTION_CASE_UNAVAILABLE'),{status:503});}
 if(data.statusCode!==200||data.result?.success!==true)throw Object.assign(Error(data.code||'EXCEPTION_CASE_UNAVAILABLE'),{status:[401,403,409,503].includes(data.statusCode)?data.statusCode:409});
 return data.result;
}
module.exports={invoke};
