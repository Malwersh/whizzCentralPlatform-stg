'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {GetCommand,TransactWriteCommand,PutCommand}=require('@aws-sdk/lib-dynamodb');
const {createAccess}=require('../merchant-financial-access');
function fixture(){let code,revoked=false,identityChecks=0;const rows=new Map(),transactions=[];const k=x=>JSON.stringify(x);
 const branch={businessId:'b1',ownerId:'u1',cognitoUserId:'u1',status:'approved',version:1};
 const db={async send(c){const q=c.input;if(c.constructor.name==='GetCommand'){if(q.TableName==='WhizzMerchants_Businesses')return {Item:{...branch}};if(q.TableName==='staging-AccountDeletion')return {};return {Item:structuredClone(rows.get(k(q.Key)))};}
 if(c.constructor.name==='TransactWriteCommand'){for(const x of q.TransactItems){if(x.Put){const old=rows.get(k({pk:x.Put.Item.pk,sk:x.Put.Item.sk}));if(old&&old.version!==x.Put.ExpressionAttributeValues?.[':version'])throw Error('conflict');}}for(const x of q.TransactItems)if(x.Put)rows.set(k({pk:x.Put.Item.pk,sk:x.Put.Item.sk}),structuredClone(x.Put.Item));transactions.push(q);return {};}
 throw Error('unexpected command');}};
 const owner={subjectId:'u1',revalidate:async()=>{identityChecks++;if(revoked)throw Error('revoked');return {sub:'u1',phone_number_verified:'true',phone_number:'+9647800000000'};}};
 const access=createAccess({db,payoutOtp:{secret:async()=> 's'.repeat(32),send:async(_,v)=>code=v}},owner),input={branchId:'b1',deviceId:'device_12345678901234567890123'};
 return {access,input,transactions,checks:()=>identityChecks,revoke:()=>revoked=true,async unlock(){const c=await access.act({action:'FINANCIAL_START',...input});const s=await access.act({action:'FINANCIAL_UNLOCK',...input,challengeId:c.challengeId,code});return {deviceId:input.deviceId,token:s.token};}};
}
test('financial data rejects missing session before returning data',async()=>{const f=fixture();await assert.rejects(f.access.protect({branchId:'b1',view:'payouts'}),{code:'PAYOUT_FINANCIAL_UNLOCK_REQUIRED'});});
test('financial write carries owner, deletion and session guards in its transaction',async()=>{const f=fixture(),financialAccess=await f.unlock(),gate=await f.access.protect({branchId:'b1',action:'ACK_PAYOUT_RECEIPT',financialAccess});assert.equal(gate.body.financialAccess,undefined);await gate.db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:'Example',Item:{pk:'operation',sk:'META'}}}]}));const tx=f.transactions.at(-1).TransactItems;assert.equal(tx.filter(x=>x.ConditionCheck).length,4);assert.ok(tx.some(x=>x.ConditionCheck?.Key.sk==='SESSION'));await assert.rejects(gate.db.send(new PutCommand({TableName:'Example',Item:{pk:'bad'}})),{code:'PAYOUT_FINANCIAL_WRITE_REQUIRES_TRANSACTION'});});
test('revocation during a read denies final response verification',async()=>{const f=fixture(),financialAccess=await f.unlock(),gate=await f.access.protect({branchId:'b1',financialAccess});f.revoke();await gate.db.send(new GetCommand({TableName:'Example',Key:{pk:'x'}}));await assert.rejects(gate.verify(),/revoked/);});
test('verification endpoint rejects caller-supplied identity or phone',async()=>{const f=fixture();await assert.rejects(f.access.act({action:'FINANCIAL_START',...f.input,phone:'+9647800000000'}),{code:'PAYOUT_FINANCIAL_INVALID_REQUEST'});});
test('enabled owner route rejects an unverified financial request before reading settlements',async()=>{
 const {owner}=require('../settlement-schedules');
 await assert.rejects(owner({enabled:true,financialLockEnabled:true,db:{send:async()=>{throw Error('must not read financial data');}}},'u1','GET',{branchId:'b1',view:'payouts'},{subjectId:'u1',revalidate:async()=>({})}),{code:'PAYOUT_FINANCIAL_UNLOCK_REQUIRED'});
});

test('many internal reads validate identity only at request boundaries',async()=>{const f=fixture(),financialAccess=await f.unlock(),before=f.checks(),gate=await f.access.protect({branchId:'b1',financialAccess});for(let i=0;i<40;i++)await gate.db.send(new GetCommand({TableName:'Example',Key:{pk:String(i)}}));await gate.verify();assert.equal(f.checks()-before,4);});
test('revocation before a financial write prevents every transaction',async()=>{const f=fixture(),financialAccess=await f.unlock(),gate=await f.access.protect({branchId:'b1',financialAccess});f.revoke();const before=f.transactions.length;await assert.rejects(gate.db.send(new TransactWriteCommand({TransactItems:[]})),/revoked/);assert.equal(f.transactions.length,before);});
