const {test}=require('node:test'),assert=require('node:assert/strict');
const {createStagingDeliveryFundingReader:create}=require('../dist/deliveryFundingReader');
const {readDeliveryFundingPolicy:read}=require('../dist/deliveryFundingPolicy');
const {parseIqd:m}=require('../dist/money');const catalog=require('../../staff-service/catalog');
const B='WhizzMerchants_Businesses',P='staging-MerchantPlatform',S='staging-PlatformStaff',L='staging-AccountDeletion';
function fixture(lifecycleReadMode){
 const rows=new Map(),calls=[],key=(t,k)=>t+'|'+JSON.stringify(k),put=(t,k,v)=>rows.set(key(t,k),structuredClone({...k,...v})),change=(t,k)=>rows.get(key(t,k));
 const role=Object.keys(catalog.ROLES).find(r=>catalog.allowed({status:'ACTIVE',roles:[r]},'commercial.funding.request'));
 const policy={schemaVersion:1,id:'delivery',version:1,merchantId:'merchant',branchId:'branch',origin:'PLATFORM',effectiveFrom:'2026-10-16T00:00:00.000Z',effectiveTo:'2026-10-25T00:00:00.000Z',customerRule:{kind:'CAPPED_PRICE',amount:m('1500')},funding:{kind:'PLATFORM'},eligibility:{regionIds:['zone'],maximumRoadMeters:5000,minimumGoods:m('10000'),minimumGoodsBasis:'AFTER_GOODS_DISCOUNTS',audience:'ALL',goodsDiscountStacking:'ALLOW'},limits:{merchantPerOrder:m('0'),platformPerOrder:m('2500'),merchantBudget:m('0'),platformBudget:m('100000'),perCustomerUses:3},onUnavailable:'NORMAL_TARIFF'};
 const termsHash=read(policy).termsHash;
 put(B,{businessId:'branch'},{ownerId:'owner',cognitoUserId:'owner',organizationId:'merchant',status:'approved',isActive:true});
 put(P,{pk:'PERSON#owner',sk:'ORGANIZATION#merchant'},{organizationId:'merchant',subjectId:'owner'});
 const current={schemaVersion:1,id:'delivery',version:1,status:'ACTIVE',policy,termsHash,approvedBy:'editor',approvedAt:'2026-10-16T01:00:00.000Z',acceptedBy:'owner',acceptedAt:'2026-10-16T02:00:00.000Z',activatedAt:'2026-10-16T02:00:00.000Z',activationMode:'STAFF_SEND_MERCHANT_ACCEPT'};
 for(const sk of ['CURRENT','VERSION#1'])put(S,{pk:'DELIVERY_FUNDING#delivery',sk},current);
 put(S,{pk:'EMPLOYEE#editor',sk:'PROFILE'},{employeeId:'editor',version:1,status:'ACTIVE',roles:[role],scope:{allRegions:true}});
 const db={async send(c){calls.push(c);if(c.constructor.name==='TransactWriteCommand'){assert.equal(c.input.TransactItems.length,2);for(const op of c.input.TransactItems){assert.deepEqual(Object.keys(op),['ConditionCheck']);const q=op.ConditionCheck;assert.equal(q.TableName,L);assert.equal(q.ConditionExpression,'attribute_not_exists(pk)');if(rows.has(key(q.TableName,q.Key)))throw Object.assign(Error('guard failed'),{name:'TransactionCanceledException',CancellationReasons:[{Code:'ConditionalCheckFailed'}]});}return {};}assert.equal(c.constructor.name,'GetCommand');assert.equal(c.input.ConsistentRead,true);return {Item:structuredClone(rows.get(key(c.input.TableName,c.input.Key)))};}};
 const input={branchId:'branch',policyPin:{policyId:'delivery',version:1,termsHash}};
 const prepare=()=>create({db,now:()=>Date.parse('2026-10-18T00:00:00.000Z'),lifecycleReadMode}).prepare(input);
 return {rows,put,change,calls,prepare,input};
}
test('consistent exact-policy reads return existing authority fences without writes',async()=>{const f=fixture(),r=await f.prepare();assert.equal(r.policyPin.termsHash,f.input.policyPin.termsHash);assert.equal(r.operations.length,7);assert.ok(r.operations.every(x=>x.ConditionCheck));assert.ok(r.operations.some(x=>x.ConditionCheck.Key.pk==='ACCOUNT_LIFECYCLE#MERCHANT#owner'));});
test('wrong scope, stale version, altered hash, suspended policy and history mismatch reject',async()=>{
 for(const edit of [f=>f.input.policyPin.version=2,f=>f.input.policyPin.termsHash='0'.repeat(64),f=>f.change(S,{pk:'DELIVERY_FUNDING#delivery',sk:'CURRENT'}).status='PAUSED',f=>f.change(S,{pk:'DELIVERY_FUNDING#delivery',sk:'VERSION#1'}).acceptedBy='other',f=>f.change(B,{businessId:'branch'}).organizationId='foreign']){const f=fixture();edit(f);await assert.rejects(f.prepare());}
});
test('revoked sender or branch lifecycle cannot produce funding permission',async()=>{
 for(const edit of [f=>f.change(S,{pk:'EMPLOYEE#editor',sk:'PROFILE'}).roles=['unknown'],f=>f.change(S,{pk:'EMPLOYEE#editor',sk:'PROFILE'}).status='REVOKED',f=>f.put(L,{pk:'BUSINESS_LIFECYCLE#MERCHANT#branch',sk:'META'},{state:'CLOSING'}),f=>f.change(B,{businessId:'branch'}).isActive=false]){const f=fixture();edit(f);await assert.rejects(f.prepare());}
});
test('active manager reuses branch membership authority and fences; revoked manager rejects',async()=>{
 const f=fixture();for(const sk of ['CURRENT','VERSION#1'])f.change(S,{pk:'DELIVERY_FUNDING#delivery',sk}).acceptedBy='manager';
 f.put(P,{pk:'BRANCH#branch',sk:'MEMBER#manager'},{subjectId:'manager',businessId:'branch',ownerId:'owner',role:'MANAGER',status:'ACTIVE',version:1});
 const r=await f.prepare();assert.ok(r.operations.some(x=>x.ConditionCheck.Key.sk==='MEMBER#manager'));
 f.change(P,{pk:'BRANCH#branch',sk:'MEMBER#manager'}).status='REVOKED';await assert.rejects(f.prepare());
});
test('future expired and inconsistent activation dates reject',async()=>{
 for(const edit of [r=>r.policy.effectiveFrom='2026-10-19T00:00:00.000Z',r=>r.policy.effectiveTo='2026-10-18T00:00:00.000Z',r=>r.activatedAt='2026-10-16T03:00:00.000Z',r=>r.approvedAt='2026-10-17T00:00:00.000Z']){const f=fixture();for(const sk of ['CURRENT','VERSION#1']){const r=f.change(S,{pk:'DELIVERY_FUNDING#delivery',sk});edit(r);r.termsHash=read(r.policy).termsHash;}f.input.policyPin.termsHash=f.change(S,{pk:'DELIVERY_FUNDING#delivery',sk:'CURRENT'}).termsHash;await assert.rejects(f.prepare());}
});
test('unavailable database never becomes no-policy success',async()=>{await assert.rejects(create({db:{send:async()=>{throw Error('offline');}}}).prepare({branchId:'branch',policyPin:{policyId:'delivery',version:1,termsHash:'0'.repeat(64)}}),e=>e.code==='DELIVERY_POLICY_UNAVAILABLE');});

test('condition-only mode checks both lifecycle guards without reading their contents or mutating any item',async()=>{
 const f=fixture('CONDITION_CHECK'),r=await f.prepare();assert.equal(r.operations.length,7);assert.ok(!f.calls.some(c=>c.input.TableName===L));const tx=f.calls.filter(c=>c.constructor.name==='TransactWriteCommand');assert.equal(tx.length,1);assert.equal(tx[0].input.TransactItems.length,2);assert.ok(r.operations.every(x=>x.ConditionCheck));
});
test('condition-only mode rejects closing owner or branch and does not drop the final order guards',async()=>{
 for(const pk of ['ACCOUNT_LIFECYCLE#MERCHANT#owner','BUSINESS_LIFECYCLE#MERCHANT#branch']){const f=fixture('CONDITION_CHECK');f.put(L,{pk,sk:'META'},{state:'CLOSING'});await assert.rejects(f.prepare(),e=>e.code==='DELIVERY_POLICY_AUTHORITY_REVOKED');}
 const f=fixture('CONDITION_CHECK');const r=await f.prepare();assert.equal(r.operations.filter(x=>x.ConditionCheck.TableName===L).length,2);
});
test('unrecognized lifecycle mode fails closed',()=>assert.throws(()=>create({db:{send:async()=>assert.fail('must not call DB')},lifecycleReadMode:'OTHER'}),/DELIVERY_POLICY_UNAVAILABLE/));
