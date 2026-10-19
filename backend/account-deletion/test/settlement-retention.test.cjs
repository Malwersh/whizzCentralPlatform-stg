'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {GetCommand,QueryCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {settlementRetention}=require('../settlement-retention');
const {digest}=require('../commercial-retention');
const {financialPurge}=require('../financial-purge');
const {codEvidence}=require('../cod-retention');
const P='staging-MerchantPlatform',B='WhizzMerchants_Businesses',L='staging-AccountDeletion',A='staging-AccountDeletionFinancialArchive';
const rid='11111111-1111-4111-8111-111111111111',bid='MSB:'+'a'.repeat(48),when='2026-10-18T12:00:00.000Z';
function fixture(){
 const r={pk:'SUBJECT#MERCHANT#owner',sk:'REQUEST#'+rid,requestId:rid,subjectId:'owner',actorType:'MERCHANT',scope:{kind:'BUSINESS',id:'branch'},status:'PROCESSING',version:2,leaseOwner:'worker',leaseUntil:Math.floor(Date.parse(when)/1000)+300};
 const job={requestId:rid,subjectId:'owner',businessId:'branch',financialYears:7,policyVersion:3};
 const partition='MERCHANT_SETTLEMENT#branch',lineBody={schemaVersion:1,kind:'MERCHANT_SETTLEMENT_LINE',batchId:bid,branchId:'branch',orderId:'o',accrual:{branchId:'branch',orderId:'o'}};
 const line={pk:partition,sk:'LINE#'+bid+'#o',...lineBody,lineDigest:digest(lineBody)};
 const body={schemaVersion:1,kind:'MERCHANT_SETTLEMENT_BATCH',batchId:bid,branchId:'branch',requestId:rid,requestHash:'hash',createdBy:'staff',createdAt:when,status:'FROZEN_PENDING_REVIEW',payoutAuthorized:false,walletMutationPerformed:false,retentionClass:'FINANCIAL_SETTLEMENT',lineCount:1,lineDigests:[{orderId:'o',digest:line.lineDigest}]};
 const header={pk:partition,sk:'BATCH#'+when+'#'+bid,...body,batchDigest:digest(body)};
 const lookup={pk:partition,sk:'INDEX#'+bid,schemaVersion:1,kind:'MERCHANT_SETTLEMENT_LOOKUP',branchId:'branch',batchId:bid,headerSk:header.sk,batchDigest:header.batchDigest};
 const request={pk:'BRANCH#branch',sk:'SETTLEMENT_REQUEST#'+rid,schemaVersion:1,kind:'MERCHANT_SETTLEMENT_REQUEST',branchId:'branch',batchId:bid,requestId:rid,requestHash:'hash',actorId:'staff',status:'COMMITTED',batchDigest:header.batchDigest};
 const tables={[P]:[header,line,lookup,request],[B]:[{businessId:'branch',ownerId:'owner',cognitoUserId:'owner',deletionRequestId:rid}],[L]:[r,{pk:'BUSINESS_LIFECYCLE#MERCHANT#branch',sk:'META',subjectId:'owner',businessId:'branch',requestId:rid}],[A]:[]},writes=[];
 const get=(t,k)=>tables[t]?.find(row=>Object.entries(k).every(([n,v])=>row[n]===v));
 function check(row,q){
  if(q.ConditionExpression==='attribute_not_exists(pk)'){assert.equal(row,undefined);return;}
  for(const [name,field]of Object.entries(q.ExpressionAttributeNames||{}))if(name.startsWith('#c')){const n=name.slice(2),value=q.ExpressionAttributeValues?.[':c'+n];assert.deepEqual(row?.[field],value);}
  if(q.ExpressionAttributeValues?.[':owner']){assert.equal(row?.leaseOwner,q.ExpressionAttributeValues[':owner']);assert.equal(row?.version,q.ExpressionAttributeValues[':v']);assert(row.leaseUntil>q.ExpressionAttributeValues[':now']);assert.equal(row.status,'PROCESSING');assert(!row.legalHold&&!row.retentionHold);}
 }
 const db={async send(c){const q=c.input;
  if(c instanceof GetCommand)return {Item:structuredClone(get(q.TableName,q.Key))};
  if(c instanceof ScanCommand)return {Items:structuredClone(tables[q.TableName]||[])};
  if(c instanceof QueryCommand){if(db.incomplete)return {Items:[],LastEvaluatedKey:{pk:'p',sk:'s'}};return {Items:structuredClone((tables[q.TableName]||[]).filter(row=>row.pk===q.ExpressionAttributeValues[':pk']&&(!q.ExpressionAttributeValues[':prefix']||row.sk.startsWith(q.ExpressionAttributeValues[':prefix']))))};}
  assert(c instanceof TransactWriteCommand);if(db.beforeWrite){const hook=db.beforeWrite;db.beforeWrite=null;hook();}
  for(const op of q.TransactItems){const x=op.ConditionCheck||op.Put;check(get(x.TableName,x.Key||{pk:x.Item.pk,sk:x.Item.sk}),x);}
  writes.push(q.TransactItems);for(const {Put:p}of q.TransactItems)if(p)tables[p.TableName].push(structuredClone(p.Item));return {};
 }};
 return {r,job,tables,writes,db,header,line,lookup,request,run:()=>settlementRetention({db,r,job,clock:()=>when,maxPages:2})};
}
test('archives every statement component without modifying sources or wallets, and retries preserve retention clocks',async()=>{
 const f=fixture(),before=structuredClone(f.tables[P]);assert.deepEqual(await f.run(),{archived:4,sourceDeleted:false});assert.deepEqual(f.tables[P],before);
 const original=structuredClone(f.tables[A]);assert(original.every(x=>x.purgeBlocked===true&&x.expiresAt===undefined&&x.minimumRetainUntil> Date.parse(when)/1000));assert.equal((await f.run()).archived,0);assert.deepEqual(f.tables[A],original);
 for(const tx of f.writes){assert.equal(tx.length,5);assert(tx.some(x=>x.ConditionCheck?.TableName===B));assert(tx.every(x=>!x.Delete&&!x.Update));}
 const out=await financialPurge({db:f.db,clock:()=>4000000000,dryRun:false})();assert.equal(out.blocked,4);assert.equal(out.removed,0);assert.deepEqual(f.tables[A],original);
});
test('missing, corrupt, duplicate, foreign or held evidence stops before any archive',async()=>{
 for(const mode of ['missingLine','missingLookup','missingRequest','digest','foreign','hold','duplicate','orphan','unknown','extraRequest']){
  const f=fixture();if(mode==='missingLine')f.tables[P].splice(1,1);if(mode==='missingLookup')f.tables[P].splice(2,1);if(mode==='missingRequest')f.tables[P].pop();if(mode==='digest')f.header.lineCount=2;if(mode==='foreign')f.line.branchId='other';if(mode==='hold')f.line.retentionHold=true;if(mode==='duplicate')f.tables[P].push(f.line);if(mode==='orphan')f.tables[P]=[f.line];if(mode==='unknown')f.tables[P].push({pk:f.header.pk,sk:'UNKNOWN',branchId:'branch',schemaVersion:1});if(mode==='extraRequest')f.tables[P].push({...f.request,requestId:'22222222-2222-4222-8222-222222222222',sk:'SETTLEMENT_REQUEST#22222222-2222-4222-8222-222222222222'});
  await assert.rejects(f.run(),/SETTLEMENT_RETENTION|DOCUMENTED_RETENTION_HOLD/);assert.equal(f.writes.length,0,mode);
 }
});
test('scope, lease, ownership, lifecycle and source races prevent archive commits',async()=>{
 for(const mode of ['owner','lifecycle','scope','leaseRace','holdRace','sourceRace','branchRace']){
  const f=fixture();if(mode==='owner')f.tables[B][0].ownerId='other';if(mode==='lifecycle')f.tables[L][1].requestId='other';if(mode==='scope')f.r.scope.kind='MEMBERSHIP';
  if(mode==='leaseRace')f.db.beforeWrite=()=>{f.r.leaseOwner='other';};if(mode==='holdRace')f.db.beforeWrite=()=>{f.r.retentionHold=true;};if(mode==='sourceRace')f.db.beforeWrite=()=>{f.header.status='CHANGED';};if(mode==='branchRace')f.db.beforeWrite=()=>{f.tables[B][0].ownerId='other';};
  await assert.rejects(f.run());assert.equal(f.writes.length,0,mode);assert.equal(f.tables[A].length,0);
 }
});
test('archive conflicts and legal holds are inventoried before first retry write',async()=>{
 for(const mode of ['conflict','hold','ttl']){const f=fixture();await f.run();f.writes.length=0;const a=f.tables[A].at(-1);if(mode==='conflict')a.data.status='changed';if(mode==='hold')a.legalHold=true;if(mode==='ttl')a.expiresAt=1;await assert.rejects(f.run(),/ARCHIVE_CONFLICT|DOCUMENTED_RETENTION_HOLD/);assert.equal(f.writes.length,0);}
});
test('bounded pagination fails closed, and empty branches remain compatible',async()=>{
 const f=fixture();f.db.incomplete=true;await assert.rejects(f.run(),/SETTLEMENT_INVENTORY_INCOMPLETE/);assert.equal(f.writes.length,0);
 const g=fixture();g.tables[P]=[];assert.deepEqual(await g.run(),{archived:0,sourceDeleted:false});
});
test('payable settlement membership survives COD evidence redaction without customer data',()=>{
 const row={settlementBatchId:bid,settlementLineDigest:'b'.repeat(64),settlementClaimedAt:when,customerPhone:'PRIVATE'};assert.deepEqual(codEvidence(row),{settlementBatchId:bid,settlementLineDigest:'b'.repeat(64),settlementClaimedAt:when});
});
