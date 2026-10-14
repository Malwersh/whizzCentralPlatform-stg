const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture({balance=0,legacyBalance=0,foreignProfile=false,foreignWallet=false,paginated=false,failedRead=false,orderStatus='preparing',legacyPaymentStatus}={}){
 const classes={};for(const name of ['GetCommand','QueryCommand','ScanCommand'])classes[name]=class{constructor(input){this.name=name;this.input=input;}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/../customer-evidence.js','utf8'),{module,require:n=>n==='./policy'?require('../policy'):classes});
 const db={send:async c=>{const i=c.input;if(failedRead&&i.TableName==='staging-Holds')throw Error('Read failure');
  if(c.name==='GetCommand'){if(i.TableName==='WizzUser_users_staging')return {};return {Item:{walletId:'WALLET#CUSTOMER#sub',ownerType:'CUSTOMER',ownerId:foreignWallet?'victim':'sub',currency:'IQD',version:1,availableBalance:balance,lockedBalance:0}};}
  if(c.name==='QueryCommand'){if(i.IndexName==='phone-index')return {Items:[{userId:'legacy',cognitoUsername:'cognito'}]};if(i.IndexName==='email-index')return {Items:[{userId:'legacy',email:'verified@test.invalid',cognitoUsername:foreignProfile?'victim':'verified@test.invalid'}]};return {Items:i.ExpressionAttributeValues[':value']==='legacy'?[{walletId:'legacy-wallet',userId:'legacy',balance:legacyBalance,currency:'IQD'}]:[]};}
  if(i.TableName==='WizzUser_transactions_staging')return {Items:legacyPaymentStatus?[{transactionId:'payment',userId:'legacy',status:legacyPaymentStatus}]:[]};
  return {Items:i.TableName==='WizzOrders'?[{orderId:'active',userId:'legacy',status:orderStatus},{orderId:'done',userSub:'sub',status:'delivered'}]:[],...(paginated?{LastEvaluatedKey:{pk:'next'}}:{})};
 }};
 return {read:module.exports.customerEvidence({db,maxPages:2}),actor:{type:'CUSTOMER',sub:'sub',username:'cognito',attrs:{email:'verified@test.invalid',email_verified:'true'}}};
}
test('legacy and canonical identities share one eligibility check across both wallets',async()=>{const f=fixture({balance:5000,legacyBalance:2500}),r=await f.read(f.actor);assert.equal(r.wallets.length,2);assert.deepEqual(Array.from(r.wallets,w=>w.available),[5000,2500]);assert.equal(r.activeOrders.length,1);assert.equal(r.activeOrders[0].orderId,'active');});
test('legacy email alone cannot authorize another profile deletion',async()=>{const f=fixture({foreignProfile:true});await assert.rejects(f.read(f.actor),/IDENTITY_AMBIGUOUS/);});
test('wrong wallet owner fails closed',async()=>{const f=fixture({foreignWallet:true});await assert.rejects(f.read(f.actor),/EVIDENCE_UNAVAILABLE/);});
test('invalid legacy balance is never assumed zero',async()=>{const f=fixture({legacyBalance:'0'});await assert.rejects(f.read(f.actor),/EVIDENCE_UNAVAILABLE/);});
test('scan failure cannot be treated as no active holds',async()=>{const f=fixture({failedRead:true});await assert.rejects(f.read(f.actor),/Read failure/);});
test('incomplete pagination cannot authorize cleanup',async()=>{const f=fixture({paginated:true});await assert.rejects(f.read(f.actor),/EVIDENCE_INCOMPLETE/);});

test('phone-only legacy identity still requires an exact Cognito binding',async()=>{const f=fixture();f.actor.attrs={phone_number_verified:'true',phone_number:'+9647831367435'};assert.equal((await f.read(f.actor)).profileIds[0],'legacy');});
test('restaurant-canceled order does not block account deletion',async()=>{const f=fixture({orderStatus:'canceled_by_restaurant'});assert.equal((await f.read(f.actor)).activeOrders.length,0);});
test('unknown order state remains a blocker',async()=>{const f=fixture({orderStatus:'unknown_new_state'});assert.equal((await f.read(f.actor)).activeOrders.length,1);});

test('pending legacy payment blocks eligibility even with zero wallet balance',async()=>{const f=fixture({legacyPaymentStatus:'PENDING'});assert.equal((await f.read(f.actor)).pendingPayments.length,1);});
test('settled legacy payments are retained without blocking deletion',async()=>{const f=fixture({legacyPaymentStatus:'SUCCESS'});assert.equal((await f.read(f.actor)).pendingPayments.length,0);});
