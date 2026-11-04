'use strict';const fs=require('fs'),Module=require('module'),assert=require('node:assert/strict');
const p='/private/tmp/cancellation-231',entry=p+'/order/dist/index.js';let delegated=0,auth=0,authorized=true;
function load(){const m=new Module(entry,module);m.filename=entry;m.paths=Module._nodeModulePaths(p+'/order/dist');const base=m.require.bind(m);m.require=name=>{
 if(name==='./orderAuth')return {authorizeOrder:async(event,body)=>{auth++;if(!authorized)throw Object.assign(Error('UNAUTHORIZED'),{status:401});return {...body,requestedBy:'verified-customer'};}};
 if(name==='./db')return {TABLES:{ORDERS:'WizzOrders'},GetCommand:class{constructor(input){this.input=input;}},docClient:{send:async()=>({Item:{exceptionPolicy:{version:'v1'}}})}};
 if(name==='../financial-cancellation-client')return {invokeCustomerCancellation:async(event,body)=>{assert.equal(body.requestedBy,'verified-customer');assert.equal(event.headers.Authorization,'Bearer synthetic-offline');delegated++;return {success:true,orderId:body.orderId,cancelled:false,cancellationStatus:'REQUESTED'};}};
 return base(name);
 };m._compile(fs.readFileSync(p+'/order-candidate.js','utf8'),entry);return m.exports;}
(async()=>{const api=load(),event={path:'/order/cancel',httpMethod:'POST',headers:{Authorization:'Bearer synthetic-offline'},body:JSON.stringify({orderId:'order1',canceledBy:'customer',reason:'requested',requestedBy:'forged'})};let r=await api.handler(event);assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).cancelled,false);assert.equal(delegated,1);authorized=false;r=await api.handler(event);assert.equal(r.statusCode,401);assert.equal(delegated,1);assert.equal(auth,2);
 // Client pins sole writer and never forwards client-chosen subject, amount or role.
 const {invokeCustomerCancellation}=require('../backend/order-service/financial-cancellation-client');let sent;
 const client={send:async cmd=>{sent=JSON.parse(Buffer.from(cmd.input.Payload).toString());return {Payload:Buffer.from(JSON.stringify({statusCode:200,result:{success:true,orderId:'order1',cancelled:false,cancellationStatus:'REQUESTED'}}))};}};
 const input={orderId:'order1',reason:'valid reason',requestedBy:'verified-customer',cancellationProtocolVersion:1,amount:999};await invokeCustomerCancellation(event,input,client);assert.deepEqual(Object.keys(sent.body).sort(),['idempotencyKey','orderId','reason']);assert.equal(sent.action,'request_customer_cancellation');assert.equal(sent.accessToken,'synthetic-offline');const key=sent.body.idempotencyKey;await invokeCustomerCancellation(event,input,client);assert.equal(sent.body.idempotencyKey,key);await assert.rejects(invokeCustomerCancellation(event,{...input,cancellationProtocolVersion:undefined},client),/CANCELLATION_REQUESTED/);
 console.log('PASS actual order entry authorizes before new-policy delegation; writer adapter pins credential/selectors/idempotency and protects old clients from false cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
