'use strict';
const {ScanCommand,GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const EVENTS='staging-WalletLifecycle',ARCHIVE='staging-AccountDeletionFinancialArchive';
const terminal=new Set(['delivered','completed','returned','cancelled','canceled','rejected','expired','refunded']);
const isMerchantResponse=r=>r.kind==='MERCHANT_RESPONSE'&&r.merchantResponseSchemaVersion===1;
const isEvent=r=>isMerchantResponse(r)||r.integrationSchemaVersion===1&&(/^COD_.*_OUTBOX$/.test(r.kind||'')||r.kind==='DISPATCH_RESPONSE_INTEGRATION');
const isDispatch=r=>['DISPATCH_RESPONSE_OUTBOX','LEGACY_ACCEPTANCE_ATTEMPT','DISPATCH_RESTART_START','DISPATCH_CYCLE_HISTORY'].includes(r.kind);
const dispatchDone=r=>r.kind==='DISPATCH_RESTART_START'?['STARTED','SUPPRESSED_DELETION','STALE'].includes(r.state):r.kind==='DISPATCH_CYCLE_HISTORY'?r.state==='ARCHIVED':r.kind==='DISPATCH_RESPONSE_OUTBOX'?['INTEGRATED','SUPPRESSED_DELETION'].includes(r.state):r.kind==='LEGACY_ACCEPTANCE_ATTEMPT'&&r.state==='ASSIGNED';
const doneEvent=r=>isMerchantResponse(r)?['DONE','SUPPRESSED_DELETION'].includes(r.status):['INTEGRATED','SUPPRESSED_DELETION'].includes(r.status);
const isAccepted=r=>(r.kind==='FINANCIAL_DRIVER_OFFER'&&r.schemaVersion===2&&r.responseStatus==='financial_accepted'||typeof r.dispatchCycleId==='string'&&typeof r.legacyTermsDigest==='string'&&r.responseStatus==='accepted'&&r.dispatchReceipt?.kind==='PINNED_LEGACY_ACCEPTANCE'&&r.dispatchReceipt.success===true)&&r.isWinner===true;
const held=r=>r.legalHold===true||r.retentionHold===true;
const pick=(row,keys)=>Object.fromEntries(keys.filter(k=>row?.[k]!==undefined).map(k=>{const v=row[k];if(v!==null&&!['string','number','boolean'].includes(typeof v))throw error('COD_FINANCIAL_RECORD_INVALID');return [k,v];}));
const scalarFields=['settlementBatchId','settlementLineDigest','settlementClaimedAt','responseMode','responseDigest','merchantResponseSchemaVersion','actorKind','schemaVersion','financialSchemaVersion','integrationSchemaVersion','kind','orderId','operationId','financialOperationId','offerId','offerDigest','driverId','subjectId','branchId','walletId','holdId','attempt','waveNumber','assignmentAttempt','dispatchJobId','status','statusCreatedAt','outcome','responseStatus','isWinner','amount','holdAmount','holdStatus','cashCollected','cashCollectedAmount','success','replayed','createdAt','updatedAt','acceptedAt','sentAt','expiresAt','responseAt','settledAt','releasedAt','deliveredAt','completedAt','returnedAt','settlementOperationId','releaseOperationId','metricsResult','integrationVersion','integratedAt','notificationEventId','driverCompensationStatus','compensationStatus','version','returnId','purpose','driverSubjectId','confirmedBy','confirmedAt','confirmationDigest','allItemsReceived','condition','driverResponsibility','holdReleased','financialReviewRequired','state','eventId','eventType','cycleId','assignmentId','attemptId','acceptanceAttemptId','offerDigest','legacyTermsDigest','legacyOrderDigest','dispatchCycleId','dispatchKeyVersion','responseOperationId','baseDeliveryFee','bonusAmount','estimatedEarningsAtOffer','holdRequiredAmount','currency','legacySourceVersion','tipAmount','legacyPresentationDigest','legacyBranchDigest','requestId','requestDigest','caseId','action','resultCode','executionId','executed','executedAt','notificationsDelivered','restartId','startStatus','cycleDigest','previousCycleId','replacementCycleId','policyVersion','startedAt','attempts','nextAttemptAt'];
const moneyFields=['customerTotal','customerDeliveryFee','driverEarning','driverTip','driverWalletHold'];
function money(v){if(!v||v.currency!=='IQD'||v.scale!==1000||v.moneySchemaVersion!==1||!Number.isSafeInteger(v.minorAmount))throw error('COD_FINANCIAL_RECORD_INVALID');return pick(v,['currency','scale','moneySchemaVersion','minorAmount']);}
function amounts(v){const out=pick(v,['ruleVersion','basis','paymentMethod','allocationSchemaVersion']);for(const [k,x]of Object.entries(v||{}))if(x&&typeof x==='object'&&x.moneySchemaVersion!==undefined)out[k]=money(x);return out;}
function terms(v){const out=pick(v,['schemaVersion','offerId','offerDigest','ruleHash','offeredPolicyVersion','acceptedAt','paymentMethod']);for(const k of moneyFields)if(v?.[k]!==undefined)out[k]=money(v[k]);if(v?.allocation)out.allocation=amounts(v.allocation);if(v?.rule)out.rule=pick(v.rule,['id','version']);if(v?.calculation){out.calculation=pick(v.calculation,['engineVersion','basis','totalDistanceMeters','totalDurationSeconds']);out.calculation.components=amounts(v.calculation.components);if(v.calculation.driverEarning)out.calculation.driverEarning=money(v.calculation.driverEarning);}return out;}
/** Financial allowlist only: never copy raw offer source, route endpoints, free text or proof uploads. */
function codEvidence(row){
 const out=pick(row,scalarFields);for(const k of Object.keys(out))if(out[k]!==null&&!['string','number','boolean'].includes(typeof out[k]))throw error('COD_FINANCIAL_RECORD_INVALID');
 for(const k of ['acceptedTerms','financialAcceptance'])if(row[k])out[k]=terms(row[k]);
 if(row.allocation)out.allocation=amounts(row.allocation);
 if(row.financialOffer){out.offer=pick(row.financialOffer,['offerId','digest','snapshotId','snapshotHash','orderRevision','assignmentId','assignmentVersion','policyVersion','ruleHash','driverSubjectId','branchId']);out.offer.allocation=amounts(row.financialOffer.allocation);}
 if(row.financialSnapshot){const s=row.financialSnapshot;out.snapshot=pick(s,['schemaVersion','snapshotId','snapshotHash','hash','revision','digest']);const v=s.snapshot||s.order||s;out.snapshot.allocation=amounts(v.allocation);}
 if(row.commercialPricing){out.agreement=pick(row.commercialPricing.agreement,['id','version','termsHash']);out.funding=pick(row.commercialPricing.funding,['holdId','state']);if(row.commercialPricing.funding?.amount)out.funding.amount=money(row.commercialPricing.funding.amount);}
 if(row.agreement)out.agreement=pick(row.agreement,['id','version','termsHash']);
 if(row.metadata){out.binding=pick(row.metadata,['offerId','offerDigest','assignmentAttempt','agreementId','agreementVersion','pinnedDispatchAttemptId']);if(row.metadata.fundingPolicy)out.binding.fundingPolicy=pick(row.metadata.fundingPolicy,['id','version']);}
 for(const k of ['receipt','financialReceipt','dispatchReceipt'])if(row[k])out[k]=pick(row[k],scalarFields.concat(['capturedAmount','holdCaptured','releasedAmount','goodsReceived','cashCollected','cashCollectedAmount']));
 if(row.releasedHold)out.releasedHold=codEvidence(row.releasedHold);
 if(row.journalLines){if(!Array.isArray(row.journalLines)||row.journalLines.length>20)throw error('COD_FINANCIAL_RECORD_INVALID');out.journalLines=row.journalLines.map(l=>{if(!['AVAILABLE','LOCKED'].includes(l.balanceType)||l.unit!=='IQD_WHOLE'||![l.delta,l.balanceBefore,l.balanceAfter].every(Number.isSafeInteger))throw error('COD_FINANCIAL_RECORD_INVALID');return pick(l,['walletId','balanceType','unit','delta','balanceBefore','balanceAfter']);});}
 return out;
}
function exact(row,extra=[]){const names={},values={},parts=[];for(const [i,k]of [...new Set([...Object.keys(row),...extra,'legalHold','retentionHold'])].entries()){names['#c'+i]=k;if(row[k]===undefined)parts.push('attribute_not_exists(#c'+i+')');else {values[':c'+i]=row[k];parts.push('#c'+i+'=:c'+i);}}return {ConditionExpression:parts.join(' AND '),ExpressionAttributeNames:names,...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})};}
async function scan(db,table,maxPages){let rows=[],cursor;for(let page=0;page<maxPages;page++){const r=await db.send(new ScanCommand({TableName:table,ConsistentRead:true,ExclusiveStartKey:cursor,Limit:100}));rows.push(...r.Items||[]);cursor=r.LastEvaluatedKey;if(!cursor)return rows;}throw error('EVIDENCE_INCOMPLETE');}
async function pendingCod({db,driverIds=[],branchId,orderIds=[],maxPages=100}){
 const owned=r=>driverIds.includes(r.driverId)||driverIds.includes(r.subjectId)||branchId&&r.branchId===branchId||orderIds.includes(r.orderId);
 const events=(await scan(db,EVENTS,maxPages)).filter(r=>isEvent(r)&&!doneEvent(r)&&owned(r)).map(r=>({operationId:r.operationId,status:'COD_INTEGRATION_PENDING'}));
 const dispatch=(await scan(db,'WizzDispatchJobs_staging',maxPages)).filter(r=>isDispatch(r)&&!dispatchDone(r)&&owned(r)).map(r=>({operationId:r.eventId||r.attemptId||r.restartId||r.cycleId,orderId:r.orderId,status:'DISPATCH_INTEGRATION_PENDING'}));
 return [...events,...dispatch];
}

async function reviewRows(db,maxPages){
 const fields=['pk','sk','kind','schemaVersion','orderId','branchId','regionId','status','caseId','requestId','requestDigest','baseDigest','action','resultCode','executionId','receipt','createdAt','executedAt','actorId','actorVersion','legalHold','retentionHold','financialArchiveConfirmed','codFinancialEvidence','accountDeletionRequestId','financialRetainUntil'];
 const names=Object.fromEntries(fields.map((k,i)=>['#r'+i,k]));let rows=[],cursor;
 for(let page=0;page<maxPages;page++){const r=await db.send(new ScanCommand({TableName:'staging-PlatformStaff',ConsistentRead:true,Select:'SPECIFIC_ATTRIBUTES',Limit:100,ExclusiveStartKey:cursor,ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:{...names,'#kind':'kind','#pk':'pk'},FilterExpression:'begins_with(#pk,:prefix) AND #kind=:kind',ExpressionAttributeValues:{':prefix':'DISPATCH_REVIEW#',':kind':'DISPATCH_REVIEW_DECISION'}}));rows.push(...r.Items||[]);cursor=r.LastEvaluatedKey;if(!cursor)return rows.filter(x=>x.kind==='DISPATCH_REVIEW_DECISION');}throw error('EVIDENCE_INCOMPLETE');
}
function codRetention({db,requestTable='staging-AccountDeletion',archiveTable=ARCHIVE,clock=()=>new Date().toISOString(),maxPages=100}){
 if(requestTable!=='staging-AccountDeletion'||archiveTable!==ARCHIVE)throw error('INVALID_STAGING_TABLE');
 return async(r,job,{actorType,ids})=>{
  if(!['DRIVER','CUSTOMER','MERCHANT'].includes(actorType)||!Array.isArray(ids)||!ids.length||!r.leaseOwner||r.status!=='PROCESSING'||r.requestId!==job.requestId||r.subjectId!==job.subjectId)throw error('INVALID_CLEANUP_SCOPE');
  if(!Number.isInteger(job.financialYears)||job.financialYears<1||job.financialYears>30)throw error('RETENTION_POLICY_INVALID');
  if(actorType==='MERCHANT'&&(r.scope?.kind!=='BUSINESS'||!ids.includes(r.scope.id)))throw error('INVALID_CLEANUP_SCOPE');
  const orders=await scan(db,'WizzOrders',maxPages),ownedOrders=orders.filter(o=>actorType==='DRIVER'?ids.includes(o.driverId)||ids.includes(o.assignedDriverId):actorType==='MERCHANT'?ids.includes(o.storeId)||ids.includes(o.businessId):ids.includes(o.userId)||ids.includes(o.customerId)||ids.includes(o.userSub));
  const orderIds=ownedOrders.map(o=>o.orderId),events=await scan(db,EVENTS,maxPages),offers=await scan(db,'WaveOffers_staging',maxPages),holds=await scan(db,'staging-Holds',maxPages);
  const owned=x=>actorType==='DRIVER'?ids.includes(x.driverId)||ids.includes(x.subjectId)||ids.some(id=>x.walletId==='WALLET#DRIVER#'+id):actorType==='MERCHANT'?ids.includes(x.branchId)||orderIds.includes(x.orderId):orderIds.includes(x.orderId);
  const accepted=offers.filter(x=>isAccepted(x)&&(owned(x)||actorType==='DRIVER'&&ids.includes(x.financialOffer?.driverSubjectId)));
  const unaccepted=actorType==='DRIVER'?[]:offers.filter(x=>x.kind==='FINANCIAL_DRIVER_OFFER'&&x.schemaVersion===2&&!isAccepted(x)&&orderIds.includes(x.orderId));
  const selectedEvents=events.filter(x=>(isEvent(x)||x.financialSchemaVersion===2)&&owned(x));
  const dispatch=(await scan(db,'WizzDispatchJobs_staging',maxPages)).filter(x=>isDispatch(x)&&(owned(x)||orderIds.includes(x.orderId)));
  const selectedHolds=holds.filter(x=>(x.metadata?.pinnedDispatchAttemptId||x.financialSchemaVersion===2||/^COD_/.test(x.kind||'')||x.sk==='PROMOTION_FUNDING'&&x.purpose==='PLATFORM_GOODS_DISCOUNT')&&owned(x));
  const reviews=(await reviewRows(db,maxPages)).filter(row=>owned(row)||orderIds.includes(row.orderId)).map(row=>{if(!/^DISPATCH_REVIEW#[a-f0-9]{64}$/.test(row.pk||'')||row.sk!=='DECISION')throw error('COD_FINANCIAL_RECORD_INVALID');const normalized=['PENDING_EXECUTION','BLOCKED_DEPENDENCY','NEEDS_REVIEW'].includes(row.status)?{...row,status:'SUPPRESSED_DELETION',resultCode:'SOURCE_DELETED',receipt:{status:'SUPPRESSED_DELETION',executed:false,requestId:row.requestId,caseId:row.caseId,resultCode:'SOURCE_DELETED',holdReleased:false}}:row;return {row,normalized,table:'staging-PlatformStaff',keys:['pk','sk'],kind:'cod_review'};});
  const inventory=[...reviews,...dispatch.map(row=>({row,table:'WizzDispatchJobs_staging',keys:['orderId','SK'],kind:'cod_dispatch'})),...accepted.map(row=>({row,table:'WaveOffers_staging',keys:['orderId','SK'],kind:'cod_offer'})),...selectedEvents.map(row=>({row,table:EVENTS,keys:['operationId'],kind:'cod_event'})),...selectedHolds.map(row=>({row,table:'staging-Holds',keys:['orderId','sk'],kind:'cod_hold'}))];
  // Complete and validate all related evidence before the first redaction/archive.
  for(const {row,table}of [...inventory,...unaccepted.map(row=>({row}))]){
   if(held(row))throw error('DOCUMENTED_RETENTION_HOLD');
   if((isDispatch(row)&&!dispatchDone(row))||(isEvent(row)&&!doneEvent(row))||(table===EVENTS&&row.financialSchemaVersion===2&&!isEvent(row)&&row.status!=='COMPLETED'))throw error('COD_INTEGRATION_PENDING');
   if(row.status==='ACTIVE')throw error('ACTIVE_HOLD_AFTER_LOCK');
   const order=orders.find(o=>o.orderId===row.orderId&&o.SK==='META');
   if(order&&held(order))throw error('DOCUMENTED_RETENTION_HOLD');
   if(!order||!terminal.has(String(order.status||'').toLowerCase()))throw error('ACTIVE_ORDER_AFTER_LOCK');
  }
  const lease=()=>({ConditionCheck:{TableName:requestTable,Key:{pk:r.pk,sk:r.sk},ConditionExpression:'leaseOwner=:owner AND leaseUntil>:now AND #v=:v AND #s=:s',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':owner':r.leaseOwner,':now':Math.floor(Date.parse(clock())/1000),':v':r.version,':s':'PROCESSING'}}});
  for(const row of unaccepted){const order=orders.find(o=>o.orderId===row.orderId&&o.SK==='META');await db.send(new TransactWriteCommand({TransactItems:[lease(),{ConditionCheck:{TableName:'WizzOrders',Key:{PK:order.PK,SK:order.SK},...exact(order)}},{Delete:{TableName:'WaveOffers_staging',Key:pick(row,['orderId','SK']),...exact(row)}}]}));}
  for(const {row,normalized,table,keys,kind}of inventory){
   const key=pick(row,keys);if(keys.some(k=>typeof key[k]!=='string'||!key[k]))throw error('COD_FINANCIAL_RECORD_INVALID');
   const data=row.codFinancialEvidence||codEvidence(normalized||row);
   // Only this archive writer stores codFinancialEvidence; retries reuse its immutable financial snapshot.
   if(row.codFinancialEvidence&&!row.financialArchiveConfirmed)throw error('COD_FINANCIAL_RECORD_INVALID');
   const now=clock(),{financialRecord}=require('./customer-cleanup');
   const record=financialRecord({...row,createdAt:row.createdAt||row.sentAt,amount:0},'audit',job,now);record.kind=kind;record.data=data;record.sourceTable=table;record.sourceKey=key;
   const archiveKey={pk:'REQUEST#'+job.requestId,sk:kind.toUpperCase()+'#'+JSON.stringify(key)};
   const {Item:previous}=await db.send(new GetCommand({TableName:archiveTable,Key:archiveKey,ConsistentRead:true}));
   if(previous&&!require('node:util').isDeepStrictEqual(previous.data,data))throw error('ARCHIVE_CONFLICT');
   const retained={...key,...pick(normalized||row,scalarFields),codFinancialEvidence:data,...pick(row,['legalHold','retentionHold']),financialArchiveConfirmed:true,accountDeletionRequestId:job.requestId,financialRetainUntil:Math.max(record.expiresAt,row.financialRetainUntil||0)};
   // Keep operational outcome/receipt fields used for late financial replays, but no raw GPS.
   for(const k of ['receipt','financialReceipt','dispatchReceipt','acceptedTerms','allocation','journalLines','agreement','releasedHold'])if(data[k])retained[k]=data[k];
   const fence=lease();
   const order=orders.find(o=>o.orderId===row.orderId&&o.SK==='META');
   await db.send(new TransactWriteCommand({TransactItems:[fence,{ConditionCheck:{TableName:'WizzOrders',Key:{PK:order.PK,SK:order.SK},...exact(order)}},...(previous?[]:[{Put:{TableName:archiveTable,Item:{...archiveKey,...record},ConditionExpression:'attribute_not_exists(pk)'}}]),{Put:{TableName:table,Item:retained,...exact(row,['financialArchiveConfirmed','accountDeletionRequestId','financialRetainUntil'])}}]}));
  }
 };
}
module.exports={codRetention,codEvidence,pendingCod,isAccepted,isEvent,doneEvent,exact};
