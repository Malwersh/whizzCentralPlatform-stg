const test=require('node:test'),assert=require('node:assert/strict');
const {hash,snapshot}=require('../customer-delivery-funding-archive');
const {prepareReplay}=require('../customer-funding-replay-plan');
const amount=n=>({moneySchemaVersion:1,currency:'IQD',scale:1000,minorAmount:n});
function funding(extra={}){const row={pk:'DELIVERY_RESERVATION#order',sk:'META',schemaVersion:1,version:2,customerId:'owner',orderId:'order',policyPin:{policyId:'policy',version:1,termsHash:'a'.repeat(64)},allocation:{schemaVersion:1,referenceFee:amount(1500000),customerFee:amount(1000000),subsidy:amount(500000),merchantShare:amount(0),platformShare:amount(500000)},status:'CAPTURED',createdAt:'2026-11-10T12:00:00Z',settledAt:'2026-11-11T12:00:00Z',...extra};row.requestDigest=hash({orderId:row.orderId,customerId:row.customerId,policyPin:row.policyPin,allocation:row.allocation});return {...row,digest:hash(row)};}

function input(){const source=funding(),key={pk:source.pk,sk:source.sk},requestId='11111111-1111-4111-8111-111111111111';return {source,key,now:2000000000,complete:true,archives:[{pk:'REQUEST#'+requestId,sk:'DELIVERY_FUNDING#'+hash(key),requestId,subjectAlias:'DELETED#'+requestId,sourceTable:'staging-PlatformStaff',sourceKeyDigest:hash(key),policyVersion:1,kind:'delivery_funding',archivedAt:'2026-11-12T12:00:00Z',expiresAt:1900000000,data:snapshot(source,key,['owner'])}]};}
test('prepares private terminal marker and exact fences without granting closure',()=>{const v=input(),before=JSON.stringify(v),r=prepareReplay(v);assert.equal(JSON.stringify(v),before);assert.equal(r.closureRequired,true);assert.equal(r.deleteEligible,false);assert.ok(!JSON.stringify(r.marker).includes('owner'));assert.ok(!('allocation' in r.marker));assert.equal(r.marker.version,3);const {digest,...body}=r.marker;assert.equal(hash(body),digest);assert.ok(r.sourceCondition.ConditionExpression.includes('attribute_not_exists'));assert.equal(r.archiveConditions.length,1);assert.ok(r.archiveConditions.every(x=>Object.keys(x).join()==='ConditionCheck'));});
for(const [name,edit] of [
 ['partial inventory',v=>v.complete=false],['missing archive',v=>v.archives=[]],
 ['held archive',v=>v.archives[0].legalHold=true],['unexpired shared retention',v=>v.archives[0].expiresAt=v.now+1],
 ['wrong locator',v=>v.archives[0].sourceKeyDigest='a'.repeat(64)],['changed archive',v=>v.archives[0].data.status='RELEASED'],
 ['duplicate archive',v=>v.archives.push(v.archives[0])],['corrupt source',v=>v.source.digest='a'.repeat(64)],
 ['pending source',v=>{v.source=funding({status:'RESERVED'});}],['held source',v=>v.source.retentionHold=true],
 ['unsafe version',v=>v.source=funding({version:Number.MAX_SAFE_INTEGER})]
])test('blocks '+name,()=>{const v=input();edit(v);assert.throws(()=>prepareReplay(v));});
test('marker is accepted by wallet replay reader',()=>{const v=input(),r=prepareReplay(v);const {readDeliveryFundingReplay}=require('../../wallet-service/dist/deliveryFundingReplay');assert.deepEqual(readDeliveryFundingReplay(r.marker,v.key,'order'),r.marker);});
