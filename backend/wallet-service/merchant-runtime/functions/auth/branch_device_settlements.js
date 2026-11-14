'use strict';
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
const fail=(code,status=403)=>{throw Object.assign(Error(code),{status});};
async function route(event,input,client=new LambdaClient({region:'us-east-1'})){
 if(process.env.SETTLEMENT_SCHEDULE_ADMIN_ENABLED!=='true')fail('SETTLEMENT_SCHEDULE_ADMIN_DISABLED',503);
 if(Object.keys(input).sort().join(',')!=='action,httpMethod,input'||input.action!=='settlements'||!['GET','POST'].includes(input.httpMethod)||!input.input||Array.isArray(input.input)||typeof input.input!=='object')fail('PAYOUT_INVALID_REQUEST',400);
 const deviceToken=(event.headers?.Authorization||event.headers?.authorization||'').replace(/^Bearer /,''),staffSession=event.headers?.['X-Staff-Session']||event.headers?.['x-staff-session'];if(!deviceToken||typeof staffSession!=='string')fail('SESSION_REVOKED',401);
 const response=await client.send(new InvokeCommand({FunctionName:'arn:aws:lambda:us-east-1:699561669180:function:staging-wizz-staff-service',InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify({action:'merchant_device_payout',deviceToken,staffSession,httpMethod:input.httpMethod,input:input.input}))}));
 if(response.FunctionError)fail('PAYOUT_UNAVAILABLE',503);let data;try{data=JSON.parse(Buffer.from(response.Payload).toString());}catch{fail('PAYOUT_UNAVAILABLE',503);}if(data.statusCode!==200)fail(typeof data.code==='string'&&/^(PAYOUT_|PERMISSION_|MEMBERSHIP_|DEVICE_|SESSION_|STAFF_|ACCOUNT_|BUSINESS_|SETTLEMENT_)/.test(data.code)?data.code:'PAYOUT_UNAVAILABLE',[400,401,403,404,409,503].includes(data.statusCode)?data.statusCode:503);return data.result;
}
module.exports={route};
