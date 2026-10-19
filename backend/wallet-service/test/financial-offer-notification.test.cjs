const {test}=require('node:test'),assert=require('node:assert/strict');
const {createStagingFinancialPushValidation:validation}=require('../dist/financialPushValidation');
const {fixture}=require('./helpers/delivery-funded-dispatch-fixture.cjs');
const {scopeEnv,scopePin}=require('./helpers/finance-rollout-fixture.cjs');
const {createStagingFinancialPushHandler:receiver,readFinancialPushReference}=require('../dist/financialOfferNotification');
const {createFinancialPushValidatorClient}=require('../dist/financialOfferNotification');
const {createStagingFinancialOfferDelivery:sender}=require('../dist/financialOfferDelivery');
const {createStagingFinancialOfferHydration:hydration}=require('../dist/financialOfferHydration');
async function setup(){
 const f=await fixture();f.env={...scopeEnv({orders:[{orderId:'order1',branchId:'branch1',customerSubjectId:'customer'}],drivers:[{driverId:'driver1',subjectId:'driver1'},{driverId:'driver2',subjectId:'driver2'}]}),PINNED_DISPATCH_ACCOUNT_ID:'699561669180',PINNED_FINANCIAL_PUSH_MODE:'REQUIRED',FINANCIAL_PUSH_VALIDATION_MODE:'REQUIRED',FINANCIAL_DELIVERY_FUNDING_MODE:'REQUIRED',PUSH_TOKENS_TABLE:'WizzCentral_PushDeviceTokens_staging'};
 f.order().userSub='customer';f.order().financeRollout=scopePin(f.env,'order1');await f.create();await f.execute();f.message=f.out.find(x=>x.id==='driver1').message;
 f.token={token:'synthetic-token',subjectId:'driver1',app:'driver',env:'staging',ttl:Math.floor(f.time/1000)+600,soundReady:[]};f.put(f.env.PUSH_TOKENS_TABLE,f.token);
 const send=f.db.send;f.db.send=async c=>{const q=c.input;if(c.constructor.name==='QueryCommand'&&q.TableName===f.env.PUSH_TOKENS_TABLE)return {Items:[f.token]};if(c.constructor.name==='GetCommand'&&(q.TableName===f.env.PUSH_TOKENS_TABLE||!q.ExpressionAttributeNames)){const row=q.TableName===f.env.PUSH_TOKENS_TABLE?f.token:f.get(q.TableName,q.Key);return {Item:row&&structuredClone(row)};}return send(c);};
 f.sent=[];f.beforeProvider=()=>{};f.receive=receiver({db:{send:async command=>{assert(['WizzCentral_PushDeviceTokens_staging','staging-PlatformStaff'].includes(command.input.TableName),'notification role attempted financial read');return f.db.send(command);}},verifyReference:async ref=>{await validation({db:f.db,env:f.env,now:()=>f.time})(ref);},env:f.env,now:()=>f.time,getMessaging:async()=>{f.beforeProvider();return {sendEachForMulticast:async m=>{f.sent.push(m);return {successCount:1};}};}});
 f.reference=null;f.post=async ref=>{f.reference=ref;return f.receive(ref);};
 f.send=sender({db:f.db,now:()=>f.time,enableDeliveryFunding:true,beforeSend:async()=>{},postSocket:async()=>{},postPush:ref=>f.post(ref)});
 f.hydrate=(actor={driverId:'driver1',subjectId:'driver1'})=>hydration({db:f.db,now:()=>f.time,enableDeliveryFunding:true,authenticate:async()=>actor,authorize:async()=>{}})(f.reference);
 return f;
}
test('financial push resolves original proof and sends reference only; authenticated hydration returns exact full view',async()=>{
 const f=await setup(),funds=f.funding();await f.send('driver1',f.message);assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].data.type,'financial_wave_offer_available');assert.equal(f.sent[0].data.eventId,f.message.eventId);assert.equal(f.sent[0].data.expiresAt,f.message.offer.expiresAt);
 for(const key of ['offer','items','customerCashToCollect','customerAddress','driverWalletHold'])assert.equal(f.sent[0].data[key],undefined);
 assert.deepEqual((await f.hydrate()).message,f.message);assert.equal(f.funding(),funds);
});
test('foreign account, changed digest, extra price and expired reference cannot hydrate or notify',async()=>{
 const f=await setup();await f.send('driver1',f.message);await assert.rejects(f.hydrate({driverId:'driver2',subjectId:'driver2'}),/UNAUTHORIZED/);
 const original=f.reference;f.reference={...original,offerDigest:'a'.repeat(64)};await assert.rejects(f.hydrate());await assert.rejects(f.receive(f.reference));
 assert.throws(()=>readFinancialPushReference({...original,price:0}));f.reference=original;f.time=Date.parse(original.expiresAt);await assert.rejects(f.hydrate());await assert.rejects(f.receive(original));assert.equal(f.sent.length,1);
});
test('reassigned token and accepted offer after token discovery cannot reach provider',async()=>{
 const f=await setup();f.token.subjectId='other';await assert.rejects(f.send('driver1',f.message),/RETRY_REQUIRED/);assert.equal(f.sent.length,0);
 const g=await setup();g.beforeProvider=()=>{g.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}).responseStatus='financial_accepted';};await assert.rejects(g.send('driver1',g.message));assert.equal(g.sent.length,0);
});
test('notification mode off, blocked driver and changed acknowledgement proof fail closed',async()=>{
 for(const change of [f=>{f.env.PINNED_FINANCIAL_PUSH_MODE='OFF';},f=>{f.get('WhizzDrivers_staging',{driverId:'driver1'}).isBanned=true;},f=>{f.get('WaveOffers_staging',{orderId:'order1',SK:'FINANCIAL#driver1#WAVE#1'}).financialDeliveryAck.referenceDigest='foreign';}]){
  const f=await setup();f.post=async ref=>{f.reference=ref;change(f);return f.receive(ref);};await assert.rejects(f.send('driver1',f.message));assert.equal(f.sent.length,0);
 }
});
test('delegated validator invokes only fixed financial service and requires exact verified reference',async()=>{
 const reference={financialPushVersion:1,offerId:'reference'};let calls=0;
 await createFinancialPushValidatorClient({async send(command){calls++;assert.equal(command.input.FunctionName,'arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept');assert.deepEqual(JSON.parse(Buffer.from(command.input.Payload)),{action:'validate_push_reference',body:reference});return {Payload:Buffer.from(JSON.stringify({statusCode:200,result:{success:true,reference}}))};}})(reference);
 assert.equal(calls,1);
 for(const result of [{FunctionError:'Unhandled'},{Payload:Buffer.from('invalid')},{Payload:Buffer.from(JSON.stringify({statusCode:200,result:{success:true,reference:{offerId:'foreign'}}}))},{Payload:Buffer.from(JSON.stringify({statusCode:403}))}])await assert.rejects(createFinancialPushValidatorClient({async send(){return result;}})(reference),/NOT_ALLOWED/);
});
test('private validation mode off cannot use the financial proof reader',async()=>{
 const f=await setup();f.env.FINANCIAL_PUSH_VALIDATION_MODE='OFF';await assert.rejects(f.send('driver1',f.message),/NOT_ALLOWED/);assert.equal(f.sent.length,0);
});
