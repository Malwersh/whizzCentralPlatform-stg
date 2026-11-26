'use strict';
const fs=require('fs');
const {run}=require('./test-dispatch-closed-staging.cjs');
const {LambdaClient,InvokeCommand}=require('@aws-sdk/client-lambda');
(async()=>{
 await run('/private/tmp/finance55/closed-dispatch-smoke.json');
 const lam=new LambdaClient({region:'us-east-1'}),results=[];
 const cases=[
  ['WizzUser-DeliveryQuotes-staging',{httpMethod:'POST',headers:{},body:'{}'},v=>v.statusCode===503&&JSON.parse(v.body).code==='QUOTES_NOT_ENABLED'],
  ['WizzUser-CreateOrder-staging',{httpMethod:'POST',resource:'/orders/commercial-preview',path:'/orders/commercial-preview',headers:{},body:'{}'},v=>v.statusCode===409&&JSON.parse(v.body).code==='COMMERCIAL_NOT_ENABLED'],
  ['staging-driver-financial-accept',{action:'accept',body:{},accessToken:'synthetic-not-an-access-token'},v=>v.statusCode===409&&v.code==='FINANCIAL_DISPATCH_DISABLED'],
  ['staging-wizz-wallet-notification-worker',{Records:[]},v=>Array.isArray(v.batchItemFailures)&&v.batchItemFailures.length===0],
 ];
 for(const[name,event,valid]of cases){const r=await lam.send(new InvokeCommand({FunctionName:name,InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify(event))}));const v=JSON.parse(Buffer.from(r.Payload).toString());if(r.FunctionError||!valid(v))throw Error('UNEXPECTED_CLOSED_RESPONSE:'+name);results.push({name,statusCode:v.statusCode??null,code:v.code??(v.body?JSON.parse(v.body).code:null),verifiedClosed:true});}
 fs.writeFileSync('/private/tmp/finance55/closed-finance-smoke.json',JSON.stringify({cases:results,providerCalls:0,applicationWrites:0,gatesChanged:false},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({additionalClosedHandlers:results.length,providerCalls:0}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
