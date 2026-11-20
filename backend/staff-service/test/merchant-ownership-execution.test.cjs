'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {createExecution}=require('../merchant-ownership-execution');
const {propose,accept}=require('../ownership-transfer-rules');
class Get{constructor(input){this.input=input;}}
class Query{constructor(input){this.input=input;}}
class Scan{constructor(input){this.input=input;}}
class Write{constructor(input){this.input=input;}}

const now=1_800_000_000_000;
const organization={pk:'PERSON#old',sk:'ORGANIZATION#org',organizationId:'org',subjectId:'old',version:1};
const branch={businessId:'branch',brandId:'brand',organizationId:'org',ownerId:'old',cognitoUserId:'old',status:'approved',updatedAt:'2026-11-19T00:00:00Z'};
const initial=propose({actor:{sub:'old',reverified:true},recipientId:'new',requestId:'request',organization,branches:[branch],now});
const request=accept({request:initial,actor:{sub:'new',reverified:true},agreementVersion:'agreement-v1',expectedDigest:initial.digest,now});

function fixture({freeze=true,balance=0,access=[],grants=[],payouts=[],destinationVerified=true,settlementApproved=true}={}){
 const calls=[];
 const ready={requestId:'request',scopeDigest:request.digest,version:1,status:'READY'};
 const ctx={
  db:{send:async command=>{
   calls.push(command);
   if(command instanceof Write)return {};
   if(command instanceof Scan)return {Items:command.input.TableName==='staging-IdempotencyKeys'?grants:[]};
   if(command instanceof Query&&command.input.ExpressionAttributeValues[':pk']){
    const pk=command.input.ExpressionAttributeValues[':pk'];
    return {Items:pk.startsWith('BRANCH#')?access:pk.startsWith('MERCHANT_PAYOUT#')?payouts:[]};
   }
   if(command instanceof Query)return {Items:[{pk:'PERSON#old',sk:'BRAND#brand',brandId:'brand',organizationId:'org',subjectId:'old',version:1}]};
   const {Key}=command.input;
   if(Key.businessId)return {Item:{...branch,orderIntakeTransferRequestId:request.requestId,orderIntakeTransferExpiresAt:request.expiresAt}};
   if(Key.walletId)return {Item:{walletId:Key.walletId,ownerType:'MERCHANT',ownerId:'branch',version:2,status:'ACTIVE',availableBalance:balance,lockedBalance:0}};
   const rows={
    OWNERSHIP_TRANSFER_FENCE:freeze?{...ready,status:'FROZEN',kind:'OWNERSHIP_TRANSFER_FENCE',organizationId:'org',expiresAt:now+60000,branchInventoryFrozen:true,financeWritesFrozen:true,accessWritesFrozen:true,offlineDevicesRevoked:true}:undefined,
    'OWNERSHIP_TRANSFER_DESTINATION#request':destinationVerified?{...ready,kind:'OWNERSHIP_TRANSFER_DESTINATION',status:'VERIFIED',recipientId:'new',profileVersion:1,expiresAt:now+60000}:undefined,
    'OWNERSHIP_TRANSFER_SETTLEMENT#request':settlementApproved?{...ready,kind:'OWNERSHIP_TRANSFER_SETTLEMENT',status:'APPROVED',recipientId:'new',profileVersion:1,proofVersion:1}:undefined,
    'ORGANIZATION#org':organization,
    PROFILE:{subjectId:'new',name:'New owner',version:1},
   };
   return {Item:rows[Key.sk]};
  }},
  guard:()=>({ConditionCheck:{TableName:'staging-PlatformStaff',Key:{pk:'EMPLOYEE#reviewer',sk:'PROFILE'}}}),
  audit:()=>({Put:{TableName:'staging-PlatformStaff',Item:{pk:'AUDIT#ownership',sk:'request'}}}),
 };
 return {calls,run:()=>createExecution({Get,Query,Scan,Write})(ctx,{employeeId:'reviewer'},request,'Review reason',now+100)};
}

test('no transaction runs until trusted writers have frozen the organization',async()=>{
 const {calls,run}=fixture({freeze:false});
 await assert.rejects(run(),/TRANSFER_MUTATION_FENCE_REQUIRED/);
 assert.equal(calls.length,1);
});

test('approval refuses a wallet balance that changed after financial review',async()=>{
 const {calls,run}=fixture({balance:500});
 await assert.rejects(run(),/TRANSFER_FINANCIAL_BLOCKERS/);
 assert.ok(!calls.some(call=>call instanceof Write));
});

test('verified evidence is pinned in the same transaction as ownership updates',async()=>{
 const {calls,run}=fixture();
 assert.equal((await run()).status,'COMPLETED');
 const items=calls.at(-1).input.TransactItems;
 const finance=items.find(item=>item.Put?.Item.sk==='OWNERSHIP_TRANSFER_FINANCE#request')?.Put;
 const access=items.find(item=>item.Put?.Item.sk==='OWNERSHIP_TRANSFER_ACCESS#request')?.Put;
 assert.equal(finance.ConditionExpression,'attribute_not_exists(pk)');
 assert.equal(finance.Item.branchChecks[0].walletVersion,2);
 assert.equal(finance.Item.settlementDecisionVersion,1);
 assert.equal(access.Item.activeAccessCount,0);
 assert.deepEqual(access.Item.branchIds,['branch']);
 const walletUpdate=items.find(item=>item.Update?.TableName==='staging-Wallets')?.Update;
 assert.equal(walletUpdate.UpdateExpression,'SET #v=:next');
 assert.equal(walletUpdate.ExpressionAttributeValues[':next'],3);
 const walletRead=calls.findIndex(command=>command instanceof Get&&command.input.TableName==='staging-Wallets');
 const transferScan=calls.findIndex(command=>command instanceof Scan&&command.input.TableName==='staging-IdempotencyKeys');
 assert.ok(walletRead>=0&&walletRead<transferScan);
 assert.ok(items.some(item=>item.ConditionCheck?.Key.pk==='MERCHANT_PAYOUT#OWNERSHIP_REVISION#branch'));
 assert.ok(items.some(item=>item.ConditionCheck?.Key.pk==='PERSON#new'&&item.ConditionCheck?.Key.sk==='PROFILE'));
 assert.ok(items.some(item=>item.Update?.TableName==='WhizzMerchants_Businesses'));
});

test('live access records prevent approval even if previous evidence said access was cleared',async()=>{
 for(const options of [
  {access:[{sk:'MEMBER#person',status:'ACTIVE'}]},
  {access:[{sk:'DEVICE#device',status:'ACTIVE'}]},
  {access:[{sk:'INVITE#pending',status:'PENDING'}]},
  {access:[{sk:'PAIRING',status:'PENDING'}]},
  {grants:[{idempotencyKey:'MERCHANT_FINANCE#branch#person',enabled:true}]},
 ]){
  const {calls,run}=fixture(options);
  await assert.rejects(run(),/TRANSFER_ACTIVE_ACCESS/);
  assert.ok(!calls.some(call=>call instanceof Write));
 }
});

test('a pending payout blocks execution even if previous finance evidence showed no pending settlements',async()=>{
 const {run,calls}=fixture({payouts:[{sk:'PAYOUT#late',kind:'MERCHANT_PAYOUT',status:'PENDING_APPROVAL'}]});
 await assert.rejects(run(),/TRANSFER_FINANCIAL_BLOCKERS/);
 assert.ok(!calls.some(call=>call instanceof Write));
});

test('unverified recipient settlement phone prevents approval',async()=>{
 const {run,calls}=fixture({destinationVerified:false});
 await assert.rejects(run(),/TRANSFER_DESTINATION_VERIFICATION_REQUIRED/);
 assert.ok(!calls.some(call=>call instanceof Write));
});

test('verified phone does not replace a separately approved settlement destination',async()=>{
 const {run,calls}=fixture({settlementApproved:false});
 await assert.rejects(run(),/TRANSFER_SETTLEMENT_APPROVAL_REQUIRED/);
 assert.ok(!calls.some(call=>call instanceof Write));
});
