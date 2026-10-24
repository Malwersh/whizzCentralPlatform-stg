'use strict';
// Offline host, actual saved quote and real read-only data. No JWT is sent to AWS
// and no order/finance write is permitted. IAM is simulated for every real read.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{createRequire}=require('node:module'),readline=require('node:readline');
const p='/private/tmp/checkout-224',root=process.cwd(),config=JSON.parse(fs.readFileSync(p+'/config.private.json')),quote=JSON.parse(fs.readFileSync(p+'/latest-quote.private.json'));
const sourceFile=process.env.CHECKOUT_HOST_224||p+'/entry-candidate.js',original=p+'/base/_discount_review/user-create-order/index.js';
const rpc=spawn('python3',[root+'/scripts/checkout-readonly-db-224.py'],{stdio:['pipe','pipe','inherit']});let id=0;const pending=new Map(),calls=[];
readline.createInterface({input:rpc.stdout}).on('line',line=>{const r=JSON.parse(line),c=pending.get(r.id);pending.delete(r.id);if(r.ok)c.resolve(r.result);else c.reject(Object.assign(Error(r.error),{name:r.error.startsWith('ROLE_DENIED')?'AccessDeniedException':'ReadOnlyRehearsalError'}));});
const db={send:async command=>{const name=command.constructor.name.replace(/\d+$/,''),input=command.input;calls.push({name,input});return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});rpc.stdin.write(JSON.stringify({id:key,name,input})+'\n');});}};
const rawGet=(table,key)=>db.send({constructor:{name:'GetCommand'},input:{TableName:table,Key:key,ConsistentRead:true}}).then(r=>r.Item);
(async()=>{const env={...config.Environment.Variables,AWS_REGION:'us-east-1'},uid=quote.pk.slice('CUSTOMER#'.length),at=Date.parse(quote.createdAt)+1000;
 const history=JSON.parse(fs.readFileSync(p+'/history-orders.private.json'));
 const old=history.filter(o=>(o.storeId||o.businessId)===quote.branchId).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))[0];assert.ok(old);
 const [branch,profile,product]=await Promise.all([rawGet('WhizzMerchants_Businesses',{businessId:quote.branchId}),rawGet(env.USERS_TABLE,{userId:uid}),rawGet('WhizzMerchants_Products',{productId:old.items[0].itemId})]);assert.ok(branch&&profile&&product);
 const helpers={...require('../backend/shared/checkout-finance-runtime-222')};for(const key of ['createFinanceRollout','createStagingQuoteOrder','createStagingDeliveryPromotionSelection']){const f=helpers[key];helpers[key]=o=>f({...o,env,now:()=>at});}
 const exported={},FakeDate=class extends Date{constructor(...a){super(...(a.length?a:[at]));}static now(){return at;}};
 const requireHost=createRequire(original),context={exports:exported,module:{exports:exported},process:{env},Buffer,Date:FakeDate,TextEncoder,TextDecoder,URL,URLSearchParams,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval,
  console:{log(){},warn(){},error(...a){if(a[0]==='Error creating order:')fs.writeFileSync(p+'/rehearsal-error.private.txt',String(a[1]?.stack||a[1]));}},
  fetch:async url=>{assert.equal(url,'https://cognito-idp.us-east-1.amazonaws.com/');return {ok:true,json:async()=>({Username:profile.cognitoUsername||'local-read-only-rehearsal',UserAttributes:[{Name:'sub',Value:quote.subjectId}]})};},
  require:n=>n==='../../checkout-finance-runtime-222.js'?helpers:n==='https'?{request(){throw Error('EXTERNAL_HTTP_BLOCKED');}}:requireHost(n)};
 vm.runInNewContext(fs.readFileSync(sourceFile,'utf8')+'\nexports.__set=db=>{baseDynamoDb=db;};',context,{filename:sourceFile});exported.__set(db);
 const token='offline.'+Buffer.from(JSON.stringify({sub:quote.subjectId,iss:'https://cognito-idp.us-east-1.amazonaws.com/'+env.USER_POOL_ID,client_id:env.USER_POOL_CLIENT_ID,token_use:'access'})).toString('base64url')+'.never-sent-to-aws';
 const body={action:'preview_commercial',storeId:quote.branchId,storeName:branch.businessName||branch.name,storeAddress:old.storeAddress||'مراجعة محلية',userId:uid,customerName:old.customerName,
 deliveryAddress:{id:quote.addressId,latitude:quote.binding.destination.latitude,longitude:quote.binding.destination.longitude,fullAddress:'مراجعة بيانات محفوظة محليًا'},paymentMethod:'cod',items:[{id:product.productId,name:product.name,price:product.price,quantity:2}],tip:500,
 quoteId:quote.sk.slice('QUOTE#'.length),idempotencyKey:'f2240000-1234-4123-8123-123456789abc'};
 assert.equal(product.price*2,7000,'match actual basket from reported screenshot');
 const result=await exported.handler({httpMethod:'POST',resource:'/orders/commercial-preview',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)});const data=JSON.parse(result.body);
 fs.writeFileSync(p+'/real-data-preview.private.json',JSON.stringify({statusCode:result.statusCode,data,calls},null,2));
 if(process.env.EXPECT_OLD_FAILURE_224){assert.equal(result.statusCode,500,JSON.stringify(data));assert.equal(data.message,'DELIVERY_POLICY_UNAVAILABLE');assert.ok(calls.some(c=>c.name==='GetCommand'&&c.input.TableName==='staging-AccountDeletion'));console.log('PASS real saved quote/data with role simulation: reproduced lifecycle GetItem denial before fix.');}
 else{assert.equal(result.statusCode,200,JSON.stringify(data));assert.ok(!calls.some(c=>c.name==='GetCommand'&&c.input.TableName==='staging-AccountDeletion'));assert.ok(calls.some(c=>c.name==='TransactWriteCommand'));assert.equal(data.commercial.customerTotal.minorAmount,9500000);console.log(JSON.stringify({result:'PASS actual saved quote and live merchant/catalog/policy/customer data, execution-role simulation on every read; offline identity only',previewHttpStatus:200,goodsIqd:data.commercial.goodsGross.minorAmount/1000,deliveryIqd:data.commercial.deliveryFee.minorAmount/1000,serviceIqd:data.commercial.serviceFee.minorAmount/1000,tipIqd:data.commercial.driverTip.minorAmount/1000,totalIqd:data.commercial.customerTotal.minorAmount/1000,realOrderCreated:false,financialWrites:false,readCount:calls.length}));}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>rpc.stdin.end());
