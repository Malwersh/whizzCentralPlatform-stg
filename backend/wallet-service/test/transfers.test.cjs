const test=require('node:test'),assert=require('node:assert/strict');
const {docClient}=require('../dist/db');const {requestTransfer,approveTransfer}=require('../dist/transferService');
process.env.WALLET_NOTIFICATIONS_TABLE='staging-WalletNotifications';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002',id='00000000-0000-4000-8000-000000000003';
const actor={id:a,type:'DRIVER',authTime:Math.floor(Date.now()/1000)};
const input={verificationId:'proof',requestId:id,recipientWalletId:'WALLET#DRIVER#'+b,amount:25000,reason:'اختبار التحويل'};
const source={walletId:'WALLET#DRIVER#'+a,ownerId:a,ownerType:'DRIVER',status:'ACTIVE',currency:'IQD',availableBalance:50000,lockedBalance:6000,version:1};
const dest={...source,walletId:input.recipientWalletId,ownerId:b,availableBalance:0,lockedBalance:0};
function otp(input){return {principalId:a,fingerprint:require('../dist/transferVerification').verificationFingerprint({principalId:a,walletId:source.walletId},input),verifiedAt:Math.floor(Date.now()/1000),expiresAt:Math.floor(Date.now()/1000)+300,used:false};}
function mock(record,expected=input){let write;docClient.send=async c=>{if(c.constructor.name==='GetCommand'){const key=c.input.Key;if(key.idempotencyKey==='CONFIG#TRANSFERS')return {Item:{config:{...require('../dist/transferSettings').defaultTransferSettings,version:1,enabled:true}}};if(key.idempotencyKey==='TRANSFER_VERIFY#proof')return {Item:otp(expected)};if(key.idempotencyKey)return {Item:record};return {Item:key.walletId===source.walletId?source:key.walletId==='WALLET#PLATFORM'?{...source,walletId:'WALLET#PLATFORM',ownerType:'PLATFORM',ownerId:'PLATFORM'}:dest};}write=c.input;return {};};return ()=>write;}
test('atomic debit/credit touches only available funds and includes balanced ledger and notifications',async()=>{const get=mock();const r=await requestTransfer(actor,input);assert.equal(r.status,'COMPLETED');const items=get().TransactItems;const updates=items.filter(i=>i.Update?.Key.walletId);assert.equal(updates.length,2);assert.ok(updates.every(i=>!i.Update.UpdateExpression.includes('lockedBalance')));assert.equal(items.filter(i=>i.Put?.Item.category==='TRANSFER').reduce((s,i)=>s+i.Put.Item.amount,0),0);assert.equal(items.filter(i=>i.Put?.Item.type==='wallet_transfer_completed').length,2);assert.ok(items.some(i=>i.Update?.Key.idempotencyKey?.startsWith('TRANSFER_DAILY#')));});
test('same request returns original result without writes and changing amount is denied',async()=>{const previous={...input,sourceWalletId:source.walletId,requestedBy:a,status:'COMPLETED'};const get=mock(previous);assert.equal((await requestTransfer(actor,input)).status,'COMPLETED');assert.equal(get(),undefined);await assert.rejects(()=>requestTransfer(actor,{...input,amount:30000}),e=>e.code==='TRANSFER_CONFLICT');});
test('invalid amounts, self-transfer and stale authentication are denied',async()=>{mock();for(const amount of [0,-1,1.5,100001,NaN])await assert.rejects(()=>requestTransfer(actor,{...input,amount}));await assert.rejects(()=>requestTransfer(actor,{...input,recipientWalletId:source.walletId}));await assert.rejects(()=>requestTransfer({...actor,authTime:0},{...input,verificationId:undefined}),e=>e.code==='REAUTH_REQUIRED');});
test('platform request does not debit and requires a different finance approver',async()=>{const get=mock();const finance={...actor,type:'FINANCE'};const r=await requestTransfer(finance,input);assert.equal(r.status,'PENDING_APPROVAL');const fences=get().TransactItems.filter(i=>i.Update?.Key.walletId);assert.equal(fences.length,2);assert.ok(fences.every(i=>i.Update.UpdateExpression==='SET #v = #v + :one'&&!i.Update.UpdateExpression.includes('availableBalance')));mock(r);await assert.rejects(()=>approveTransfer(finance,id),e=>e.code==='SECOND_APPROVER_REQUIRED');const out=mock(r);assert.equal((await approveTransfer({...finance,id:b},id)).status,'COMPLETED');assert.ok(out().TransactItems.some(i=>i.Update?.ConditionExpression.includes('requestedBy <> :actor')));});
test('insufficient available funds cannot consume locked funds',async()=>{mock();const old=source.availableBalance;source.availableBalance=0;try{await assert.rejects(()=>requestTransfer(actor,input),e=>e.code==='INSUFFICIENT_AVAILABLE_BALANCE');}finally{source.availableBalance=old;}});
test('competing settlement returns completed operation rather than crediting twice',async()=>{let settled=false,writes=0;docClient.send=async c=>{if(c.constructor.name==='GetCommand'){if(c.input.Key.idempotencyKey==='CONFIG#TRANSFERS')return {Item:{config:{...require('../dist/transferSettings').defaultTransferSettings,version:1,enabled:true}}};if(c.input.Key.idempotencyKey==='TRANSFER_VERIFY#proof')return {Item:otp(input)};if(c.input.Key.idempotencyKey)return {Item:settled?{...input,sourceWalletId:source.walletId,requestedBy:a,status:'COMPLETED'}:undefined};return {Item:c.input.Key.walletId===source.walletId?source:dest};}writes++;settled=true;const e=Error();e.name='TransactionCanceledException';throw e;};assert.equal((await requestTransfer(actor,input)).status,'COMPLETED');assert.equal(writes,1);});
test('pending platform transfers are checked against the newly reduced limit before debit',async()=>{
 const pending={...input,transferId:id,sourceWalletId:'WALLET#PLATFORM',requestedBy:a,status:'PENDING_APPROVAL',createdAt:new Date().toISOString(),expiresAt:Math.floor(Date.now()/1000)+3600};
 let writes=0;docClient.send=async c=>{if(c.constructor.name!=='GetCommand'){writes++;return {};}if(c.input.Key.idempotencyKey==='CONFIG#TRANSFERS')return {Item:{config:{...require('../dist/transferSettings').defaultTransferSettings,version:2,enabled:true,maxAmount:10000}}};return {Item:pending};};
 await assert.rejects(()=>approveTransfer({...actor,id:b,type:'FINANCE'},id),e=>e.code==='TRANSFER_SETTINGS_CHANGED');assert.equal(writes,0);
});
test('disabled settings reject new transfers without monetary writes',async()=>{
 let writes=0;docClient.send=async c=>{if(c.constructor.name!=='GetCommand'){writes++;return {};}return c.input.Key.idempotencyKey==='CONFIG#TRANSFERS'?{Item:{config:{...require('../dist/transferSettings').defaultTransferSettings,version:1,enabled:false}}}:{};};
 await assert.rejects(()=>requestTransfer(actor,input),e=>e.code==='TRANSFERS_DISABLED');assert.equal(writes,0);
});
test('daily limit counter escapes DynamoDB reserved field names',async()=>{const changed={...input,requestId:'00000000-0000-4000-8000-000000000099'};const get=mock(undefined,changed);await requestTransfer(actor,changed);const daily=get().TransactItems.find(i=>i.Update?.Key.idempotencyKey?.startsWith('TRANSFER_DAILY#')).Update;assert.equal(daily.ExpressionAttributeNames['#total'],'total');assert(daily.UpdateExpression.includes('#total'));assert(daily.ConditionExpression.includes('#total'));});

test('freshly signed-in sender still requires OTP before a new transfer',async()=>{const writes=mock();await assert.rejects(requestTransfer(actor,{...input,verificationId:undefined}),e=>e.code==='REAUTH_REQUIRED');assert.equal(writes(),undefined);});

test('employee money movement and branch audit include device/session/policy fences atomically',async()=>{
 const account={principalId:a,type:'MERCHANT',walletId:'WALLET#MERCHANT#branch',ownerId:'branch',verificationScope:'bound-device-session',deviceGuards:[{ConditionCheck:{TableName:'staging-MerchantPlatform',Key:{pk:'BRANCH#branch',sk:'MEMBER#'+a},ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':4}}}],deviceAudit:(o,action)=>({Put:{TableName:'staging-MerchantPlatform',Item:{pk:'BRANCH#branch',sk:'STAFF_AUDIT#test',action,entityId:o.transferId}}})};
 let write;
 docClient.send=async c=>{if(c.constructor.name==='GetCommand'){const k=c.input.Key;if(k.idempotencyKey==='CONFIG#TRANSFERS')return {Item:{config:{...require('../dist/transferSettings').defaultTransferSettings,version:1,enabled:true}}};if(k.idempotencyKey==='TRANSFER_VERIFY#proof')return {Item:{...otp(input),fingerprint:require('../dist/transferVerification').verificationFingerprint(account,input)}};if(k.idempotencyKey)return {};if(k.businessId)return {Item:{ownerId:'branch-owner'}};return {Item:k.walletId===account.walletId?{...source,walletId:account.walletId,ownerType:'MERCHANT',ownerId:'branch'}:dest};}write=c.input;return {};};
 const result=await requestTransfer({...actor,type:'MERCHANT',authTime:0,account},input);assert.equal(result.status,'COMPLETED');assert.ok(write.TransactItems.includes(account.deviceGuards[0]));assert.ok(write.TransactItems.some(x=>x.Put?.Item.action==='MERCHANT_STAFF_TRANSFER_COMPLETED'));assert.equal(write.TransactItems.filter(x=>x.Update?.Key.walletId).length,2);assert.ok(write.TransactItems.filter(x=>x.Update?.Key.walletId).every(x=>x.Update.ConditionExpression.includes('attribute_not_exists(deletionRequestId)')));
});
test('Staging finance transfer executes once immediately without a pending approval',async()=>{
 process.env.PLATFORM_ENVIRONMENT='staging';process.env.PLATFORM_WRITE_MODE='DIRECT';
 try{const get=mock();const result=await requestTransfer({...actor,type:'FINANCE'},input);assert.equal(result.status,'COMPLETED');const items=get().TransactItems;assert.equal(items.filter(i=>i.Put?.Item.category==='TRANSFER').length,2);assert.ok(items.some(i=>i.Put?.Item.idempotencyKey==='TRANSFER#'+id&&i.Put.Item.status==='COMPLETED'));assert.ok(!items.some(i=>i.Put?.Item.status==='PENDING_APPROVAL'));}
 finally{delete process.env.PLATFORM_ENVIRONMENT;delete process.env.PLATFORM_WRITE_MODE;}
});

test('missing transfer configuration is disabled and cannot move funds',async()=>{let writes=0;docClient.send=async c=>{if(c.constructor.name==='GetCommand')return {};writes++;return {};};await assert.rejects(requestTransfer(actor,input),e=>e.code==='TRANSFERS_DISABLED');assert.equal(writes,0);});

test('transfer audit captures exact available-only snapshots and actual ledger keys',async()=>{
 const get=mock();await requestTransfer(actor,input);
 const ops=get().TransactItems;const put=ops.find(x=>x.Put?.Item.action==='TRANSFER_COMPLETED').Put;
 const audit=put.Item;assert.equal(audit.auditSchemaVersion,2);
 assert.equal(audit.actorIdentityEvidence,'ID_ONLY');assert.equal(audit.actorType,'DRIVER');
 assert.equal(audit.before.sourceWallet.availableBalance,50000);assert.equal(audit.after.sourceWallet.availableBalance,25000);
 assert.equal(audit.after.recipientWallet.availableBalance,25000);
 assert.equal(audit.after.sourceWallet.lockedBalance,6000);assert.equal(audit.after.sourceWallet.version,2);
 assert.equal(audit.after.status,'COMPLETED');assert.equal(put.ConditionExpression,'attribute_not_exists(sk)');
 const keys=ops.filter(x=>x.Put?.Item.category==='TRANSFER').map(x=>({walletId:x.Put.Item.walletId,sk:x.Put.Item.sk}));
 assert.deepEqual(audit.references.ledger,keys);
});
test('pending transfer audit records unchanged balances with committed version fences',async()=>{
 const get=mock();await requestTransfer({...actor,type:'FINANCE'},input);
 const audit=get().TransactItems.find(x=>x.Put?.Item.action==='TRANSFER_REQUESTED').Put.Item;
 assert.equal(audit.after.balanceEffect,'NONE');assert.equal(audit.before.sourceWallet.availableBalance,audit.after.sourceWallet.availableBalance);
 assert.equal(audit.after.sourceWallet.version,audit.before.sourceWallet.version+1);
 assert.equal(audit.references.ledger,undefined);
});
test('transfer audit redacts credential material without changing ledger or amount',async()=>{
 const get=mock(undefined,{...input,reason:'Bearer private-token'});
 await requestTransfer(actor,{...input,reason:'Bearer private-token'});
 const audit=get().TransactItems.find(x=>x.Put?.Item.action==='TRANSFER_COMPLETED').Put.Item;
 assert.equal(audit.reason,'[محجوب]');assert.equal(audit.amount,input.amount);
});

test('cancelling an unexecuted attempt records no invented balance snapshots',async()=>{
 const get=mock();await require('../dist/transferService').cancelMobileTransfer(actor,input);
 const ops=get().TransactItems;const audit=ops.find(x=>x.Put?.Item.action==='TRANSFER_ATTEMPT_CANCELLED').Put.Item;
 assert.equal(audit.before,null);assert.equal(audit.after.status,'CANCELLED');assert.equal(audit.after.balanceEffect,'NONE');
 assert.equal(ops.filter(x=>x.Update?.Key.walletId).length,0);
});
test('finance audit preserves trusted staff identity at action time',async()=>{
 const get=mock();const send=docClient.send;process.env.STAFF_TABLE='staff';
 const profile={pk:'EMPLOYEE#'+a,sk:'PROFILE',employeeId:a,name:'Finance Officer',version:3,status:'ACTIVE',roles:['bootstrap_admin'],scope:{allRegions:true}};
 docClient.send=async c=>c.input.TableName==='staff'?{Item:profile}:send(c);
 try{
  await requestTransfer({...actor,type:'FINANCE'},input);
  const audit=get().TransactItems.find(x=>x.Put?.Item.action==='TRANSFER_REQUESTED').Put.Item;
  assert.equal(audit.actorIdentityEvidence,'VERIFIED_STAFF_AT_ACTION');assert.equal(audit.actorSnapshot.name,'Finance Officer');
  profile.name='Renamed';assert.equal(audit.actorSnapshot.name,'Finance Officer');
  assert.ok(get().TransactItems.some(x=>x.ConditionCheck?.TableName==='staff'));
 }finally{delete process.env.STAFF_TABLE;}
});
