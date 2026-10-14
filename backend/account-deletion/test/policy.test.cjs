const test=require('node:test'),assert=require('node:assert/strict');
const {target,blockers,decision,canFinish}=require('../policy');
const actor={sub:'subject',type:'CUSTOMER'},scope={kind:'ACCOUNT'},empty={complete:true,wallets:[],activeOrders:[],activeHolds:[],pendingTransfers:[]};
test('personal scope always uses authenticated subject, ignoring supplied account ID',()=>assert.equal(target(actor,{...scope,id:'victim'}).id,'subject'));
test('customer cannot delete a business',()=>assert.throws(()=>target(actor,{kind:'BUSINESS',businessId:'business'}),/INVALID_SCOPE/));
test('missing evidence fails closed',()=>assert.throws(()=>blockers(actor,scope,{}),/EVIDENCE_UNAVAILABLE/));
test('zero balance and approved policy are ready immediately',()=>assert.equal(decision(blockers(actor,scope,empty),{inventoryApproved:true,retentionPolicyVersion:1}),'READY'));
test('unknown retention policy cannot start irreversible cleanup',()=>assert.equal(decision([],{}),'PENDING_POLICY'));
for(const [field,code]of [['activeOrders','ACTIVE_ORDERS'],['activeHolds','ACTIVE_HOLDS'],['pendingTransfers','PENDING_TRANSFERS']])test(field+' postpones execution without refusing the request',()=>assert.equal(decision(blockers(actor,scope,{...empty,[field]:['item']}),{}),'PENDING_SETTLEMENT'));
test('available credit requires refund and cannot be silently zeroed',()=>assert.equal(blockers(actor,scope,{...empty,wallets:[{walletId:'w',available:5000,locked:0}]} )[0].code,'REFUND_REQUIRED'));
test('negative balance requires settlement',()=>assert.equal(blockers(actor,scope,{...empty,wallets:[{walletId:'w',available:-100,locked:0}]} )[0].code,'AMOUNT_DUE'));
test('malformed wallet balances fail closed',()=>assert.throws(()=>blockers(actor,scope,{...empty,wallets:[{available:'0',locked:0}]}),/EVIDENCE_UNAVAILABLE/));
test('financial employee cannot delete a business',()=>assert.throws(()=>blockers({sub:'employee',type:'MERCHANT'},{kind:'BUSINESS'},{...empty,isOwner:false}),/OWNER_REQUIRED/));
test('owner account requires transfer or closing all owned businesses',()=>assert.equal(blockers({sub:'owner',type:'MERCHANT'},scope,{...empty,ownedBusinesses:['one','two']})[0].code,'OWNED_BUSINESSES'));
test('employee membership removal is separate from business deletion',()=>assert.deepEqual(blockers({sub:'member',type:'MERCHANT'},{kind:'MEMBERSHIP'},{...empty,isMember:true,isOwner:false}),[]));
test('last required administrator needs succession, not deletion of platform data',()=>assert.equal(blockers({sub:'admin',type:'STAFF'},scope,{...empty,lastRequiredAdministrator:true})[0].code,'ADMIN_HANDOVER'));
test('partial cleanup cannot report completed',()=>{const r={status:'PROCESSING',requiredSteps:['profile','devices','identity']};assert.equal(canFinish(r,{profile:{status:'COMPLETED'}}),false);assert.equal(canFinish(r,{profile:{status:'COMPLETED'},devices:{status:'COMPLETED'},identity:{status:'COMPLETED'}}),true);});

test("normalized merchant scope retains its SMS target",()=>{const a={type:"MERCHANT",sub:"owner"};const scope=target(a,{kind:"BUSINESS",businessId:"store"});assert.deepEqual(target(a,scope),scope);assert.throws(()=>target(a,{kind:"BUSINESS",businessId:"store",id:"other"}),/INVALID_SCOPE/);});

test('inaccessible legacy asset storage is an explicit deletion blocker',()=>{
 const issues=require('../policy').blockers({type:'MERCHANT',sub:'owner'},{kind:'BUSINESS',id:'store'},{complete:true,isOwner:true,wallets:[],externalAssets:['businessPhotoUrl']});
 assert.equal(issues[0].code,'EXTERNAL_ASSET_ACCESS_REQUIRED');
});

test('external asset access is distinguished from money settlement',()=>assert.equal(require('../policy').decision([{code:'EXTERNAL_ASSET_ACCESS_REQUIRED'}],{}),'PENDING_EXTERNAL_ASSET'));
