const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture({balance=0,legacyBalance=0,foreignProfile=false,foreignWallet=false,paginated=false,failedRead=false,orderStatus='preparing',legacyPaymentStatus,benefitRows=[],benefitReadFails=false,fundingRows=[],deliveryFundingArchiveEnabled=false}={}){
 const classes={};for(const name of ['GetCommand','QueryCommand','ScanCommand'])classes[name]=class{constructor(input){this.name=name;this.input=input;}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(__dirname+'/../customer-evidence.js','utf8'),{module,require:n=>n==='./customer-delivery-funding-archive'?require('../customer-delivery-funding-archive'):n==='./customer-delivery-funding-inventory'?require('../customer-delivery-funding-inventory'):n==='./customer-benefit-inventory'?require('../customer-benefit-inventory'):n==='./cod-retention'?require('./cod-loader.cjs')(classes):n==='./policy'?require('../policy'):classes});
 const db={send:async c=>{const i=c.input;if(i.TableName==='staging-PlatformStaff')return i.Key?{Item:fundingRows.find(row=>row.pk===i.Key.pk&&row.sk===i.Key.sk)}:{Items:fundingRows};if(i.TableName==='staging-WizzOfferJourney'){if(benefitReadFails)throw Error('BenefitReadDenied');return {Items:benefitRows.filter(r=>r.pk===i.ExpressionAttributeValues[':pk'])};}if(failedRead&&i.TableName==='staging-Holds')throw Error('Read failure');
  if(c.name==='GetCommand'){if(i.TableName==='WizzUser_users_staging')return {};return {Item:{walletId:'WALLET#CUSTOMER#sub',ownerType:'CUSTOMER',ownerId:foreignWallet?'victim':'sub',currency:'IQD',version:1,availableBalance:balance,lockedBalance:0}};}
  if(c.name==='QueryCommand'){if(i.IndexName==='phone-index')return {Items:[{userId:'legacy',cognitoUsername:'cognito'}]};if(i.IndexName==='email-index')return {Items:[{userId:'legacy',email:'verified@test.invalid',cognitoUsername:foreignProfile?'victim':'verified@test.invalid'}]};return {Items:i.ExpressionAttributeValues[':value']==='legacy'?[{walletId:'legacy-wallet',userId:'legacy',balance:legacyBalance,currency:'IQD'}]:[]};}
  if(i.TableName==='WizzUser_transactions_staging')return {Items:legacyPaymentStatus?[{transactionId:'payment',userId:'legacy',status:legacyPaymentStatus}]:[]};
  return {Items:i.TableName==='WizzOrders'?[{orderId:'active',userId:'legacy',status:orderStatus},{orderId:'done',userSub:'sub',status:'delivered'}]:[],...(paginated?{LastEvaluatedKey:{pk:'next'}}:{})};
 }};
 return {read:module.exports.customerEvidence({db,maxPages:10,deliveryFundingArchiveEnabled}),actor:{type:'CUSTOMER',sub:'sub',username:'cognito',attrs:{email:'verified@test.invalid',email_verified:'true'}}};
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

test('reserved benefits are visible in deletion eligibility without exposing raw records',async()=>{
 const f=fixture({benefitRows:[{pk:'USER#sub',sk:'BENEFIT#c',version:1,grantedUses:1,usedUses:0,reservedUses:1,revoked:false}]});
 const e=await f.read(f.actor);assert.ok(e.pendingPayments.some(p=>p.status==='BENEFIT_RESERVATION_PENDING'));
});
test('benefit read denial prevents a successful eligibility result',async()=>{
 const f=fixture({benefitReadFails:true});await assert.rejects(f.read(f.actor),/BenefitReadDenied/);
});

test('funding evidence blocks eligibility without leaking financial payload',async()=>{const f=fixture({fundingRows:[{pk:'DELIVERY_RESERVATION#old',sk:'META',orderId:'old',customerId:'sub',schemaVersion:2,version:1,status:'CAPTURED'}]});const e=await f.read(f.actor);assert.ok(e.pendingPayments.some(p=>p.status==='DELIVERY_FUNDING_RETENTION_REVIEW'));assert.ok(!JSON.stringify(e).includes('DELIVERY_RESERVATION#'));});

test('enabled archive permits only verified terminal funding in eligibility',async()=>{const {hash}=require('../customer-delivery-funding-archive');const row={pk:'DELIVERY_USAGE#campaign',sk:'CUSTOMER#sub',schemaVersion:1,version:1,reservedUses:0,completedUses:2};row.digest=hash(row);const f=fixture({fundingRows:[row],deliveryFundingArchiveEnabled:true});assert.equal((await f.read(f.actor)).pendingPayments.length,0);});
test('enabled archive never clears a pending reservation',async()=>{const f=fixture({fundingRows:[{pk:'DELIVERY_RESERVATION#old',sk:'META',orderId:'old',customerId:'sub',schemaVersion:2,version:1,status:'RESERVED'}],deliveryFundingArchiveEnabled:true});assert.ok((await f.read(f.actor)).pendingPayments.some(v=>v.status==='DELIVERY_FUNDING_RESERVATION_PENDING'));});
test('enabled archive fails closed for corrupt terminal evidence',async()=>{const f=fixture({fundingRows:[{pk:'DELIVERY_USAGE#campaign',sk:'CUSTOMER#sub',schemaVersion:1,version:1,reservedUses:0,completedUses:2,digest:'bad'}],deliveryFundingArchiveEnabled:true});await assert.rejects(f.read(f.actor),/DIGEST_INVALID/);});
