'use strict';
// Post-payout correction ledger. Paid statements, original payables and wallets
// are never rewritten here. Recovery/disbursement are separate, proven actions.
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash}=require('node:crypto');
const runtime=require('./settlement-runtime');
const {allowed}=require('./catalog');
const P='staging-MerchantPlatform',B='WhizzMerchants_Businesses',H='staging-Holds',D='staging-AccountDeletion';
const policyKey={pk:'OPERATIONAL_SETTINGS#MERCHANT_CORRECTIONS',sk:'CURRENT'};
const actions=new Set(['LINK_CORRECTION_CASE','COMPLETE_CORRECTION_CASE','SET_CORRECTION_POLICY','REQUEST_SETTLEMENT_CORRECTION','APPROVE_SETTLEMENT_CORRECTION','REJECT_SETTLEMENT_CORRECTION']);
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v);
const text=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max;
const get=async(db,t,k)=>(await db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true,...(t===D?{ProjectionExpression:'#p,#s',ExpressionAttributeNames:{'#p':'pk','#s':'sk'}}:{})}))).Item;
const key=(branch,sk)=>({pk:'MERCHANT_CORRECTIONS#'+branch,sk});
function check(table,k,row){
 const n={},v={};let condition='';
 for(const [i,f]of [...new Set([...Object.keys(row),...(table===B?['deletionRequestId','deletedAt','isDeleted']:[])])].entries()){n['#f'+i]=f;condition+=(condition?' AND ':'');if(row[f]===undefined)condition+='attribute_not_exists(#f'+i+')';else {v[':v'+i]=row[f];condition+='#f'+i+'=:v'+i;}}
 return {ConditionCheck:{TableName:table,Key:k,ConditionExpression:condition,ExpressionAttributeNames:n,ExpressionAttributeValues:v}};
}
const put=(row,old)=>({Put:{TableName:P,Item:row,...(old?{ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':old.version}}:{ConditionExpression:'attribute_not_exists(pk)'})}});
function sealed(row){const {digest,...v}=row||{};return typeof digest==='string'&&digest===hash(v);}
function position(row,branch,owner){
 if(!row)return {...key(branch,'POSITION'),kind:'MERCHANT_CORRECTION_POSITION',branchId:branch,ownerId:owner,creditIqd:0,debtIqd:0,creditPaidIqd:0,debtRecoveredIqd:0,version:0};
 if(row.kind!=='MERCHANT_CORRECTION_POSITION'||row.branchId!==branch||row.ownerId!==owner||!Number.isSafeInteger(row.version)||row.version<1||['creditIqd','debtIqd','creditPaidIqd','debtRecoveredIqd'].some(k=>!Number.isSafeInteger(row[k])||row[k]<0)||row.creditPaidIqd>row.creditIqd||row.debtRecoveredIqd>row.debtIqd)fail('CORRECTION_POSITION_INVALID');return row;
}
const present=row=>({settledIqd:row.settledIqd??0,reservedIqd:row.reservedIqd??0,remainingIqd:row.amountIqd-(row.settledIqd??0),settlementProgress:row.status==='POSTED'?((row.settledIqd??0)===row.amountIqd?'SETTLED':(row.settledIqd??0)>0?'PARTIALLY_SETTLED':'UNSETTLED'):null,lastSettlementPayoutId:row.lastSettlementPayoutId||null,caseLink:row.caseLink||null,correctionId:row.correctionId,orderId:row.orderId,originalPayoutId:row.originalPayoutId,direction:row.direction,amountIqd:row.amountIqd,status:row.status,version:row.version,reference:row.reference,reason:row.reason,decisionReason:row.decisionReason||null,createdAt:row.createdAt,decidedAt:row.decidedAt||null,financialPosting:row.status==='POSTED',payoutPerformed:false});
function matches(method,input){return method==='GET'?['settlement-corrections','correction-policy'].includes(input?.view):actions.has(input?.action);}
async function route(ctx,principal,method,input){
 if(!input||Array.isArray(input)||!id(input.branchId))fail('CORRECTION_INVALID_REQUEST',400);
 const {db}=ctx;const branch=input.branchId,staff=principal.staff,owner=principal.owner;
 if(!!staff===!!owner||principal.merchantStaff)fail('CORRECTION_PERMISSION_REQUIRED',403);
 const authority=staff?runtime.createMerchantSettlementAuthority({db,principal:staff}):null;
 async function access(write=false,approve=false,amount=0){
  const guards=[];let actor;
  if(staff){const a=await authority(branch,write?'CREATE':'READ');actor=a.actorId;guards.push(...a.guards);
   if(approve){const employee=await get(db,'staging-PlatformStaff',{pk:'EMPLOYEE#'+actor,sk:'PROFILE'});if(!employee||!allowed(employee,'finance.approve')||!Number.isSafeInteger(employee.approvalLimit)||employee.approvalLimit<amount)fail('CORRECTION_APPROVAL_LIMIT',403);}
  }else{if(write)fail('CORRECTION_PERMISSION_REQUIRED',403);await owner.revalidate();actor=owner.subjectId;}
  const b=await get(db,B,{businessId:branch});
  if(!b||b.status!=='approved'||b.businessId!==branch||b.ownerId!==b.cognitoUserId||b.deletionRequestId!=null||b.deletedAt!=null||b.isDeleted===true||owner&&b.ownerId!==actor)fail('CORRECTION_BRANCH_UNAVAILABLE',404);
  guards.push(check(B,{businessId:branch},b));
  for(const pk of ['ACCOUNT_LIFECYCLE#MERCHANT#'+b.ownerId,'BUSINESS_LIFECYCLE#MERCHANT#'+branch]){const k={pk,sk:'META'};if(await get(db,D,k))fail('CORRECTION_BRANCH_UNAVAILABLE',404);guards.push({ConditionCheck:{TableName:D,Key:k,ConditionExpression:'attribute_not_exists(pk)'}});}
  return {actor,b,guards};
 }
 const a=await access(method!=='GET');
 if(method==='GET'&&input.view==='correction-policy'){
  if(Object.keys(input).some(k=>!['view','branchId'].includes(k)))fail('CORRECTION_INVALID_REQUEST',400);
  const policy=await get(db,P,policyKey);await db.send(new TransactWriteCommand({TransactItems:[...a.guards,policy?check(P,policyKey,policy):{ConditionCheck:{TableName:P,Key:policyKey,ConditionExpression:'attribute_not_exists(pk)'}}]}));
  return {policy:{version:policy?.version??0,recoveryMode:policy?.recoveryMode??'OFFSET_NEXT_SETTLEMENT',applyCredits:true,persisted:!!policy}};
 }
 if(method==='GET'){
  if(Object.keys(input).some(k=>!['view','branchId','cursor'].includes(k)))fail('CORRECTION_INVALID_REQUEST',400);
  let cursor;if(input.cursor){try{if(typeof input.cursor!=='string'||input.cursor.length>2000)throw Error();cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString());if(Object.keys(cursor).sort().join(',')!=='pk,sk'||cursor.pk!==key(branch,'').pk||!/^REQUEST#[a-f0-9-]{36}$/.test(cursor.sk))throw Error();}catch{fail('CORRECTION_INVALID_CURSOR',400);}}
  const old=await get(db,P,key(branch,'POSITION')),pos=position(old,branch,a.b.ownerId);
  const page=await db.send(new QueryCommand({TableName:P,ConsistentRead:true,KeyConditionExpression:'pk=:p AND begins_with(sk,:s)',ExpressionAttributeValues:{':p':key(branch,'').pk,':s':'REQUEST#'},Limit:25,...(cursor?{ExclusiveStartKey:cursor}:{})}));
  for(const row of page.Items||[]){if(row.ownerId!==a.b.ownerId||row.branchId!==branch)fail('CORRECTION_OWNER_CHANGED');if(row.status==='POSTED'){if(!Number.isSafeInteger(row.settledIqd??0)||!Number.isSafeInteger(row.reservedIqd??0)||(row.settledIqd??0)<0||(row.reservedIqd??0)<0||(row.settledIqd??0)+(row.reservedIqd??0)>row.amountIqd)fail('CORRECTION_PROOF_INVALID');const j=await get(db,P,key(branch,'JOURNAL#'+row.correctionId));if(!sealed(j)||j.requestDigest!==row.requestDigest||j.correctionId!==row.correctionId||['branchId','ownerId','orderId','originalPayoutId','direction','amountIqd'].some(k=>j[k]!==row[k]))fail('CORRECTION_PROOF_INVALID');}}
  const fresh=await access();if(fresh.actor!==a.actor||fresh.b.ownerId!==a.b.ownerId)fail('CORRECTION_AUTHORIZATION_CHANGED');
  const positionGuard=old?[check(P,key(branch,'POSITION'),old)]:[{ConditionCheck:{TableName:P,Key:key(branch,'POSITION'),ConditionExpression:'attribute_not_exists(pk)'}}];await db.send(new TransactWriteCommand({TransactItems:[...fresh.guards,...positionGuard]}));
  return {items:(page.Items||[]).map(present),position:{creditIqd:pos.creditIqd-pos.creditPaidIqd,debtIqd:pos.debtIqd-pos.debtRecoveredIqd,creditReservedIqd:pos.creditReservedIqd??0,debtReservedIqd:pos.debtReservedIqd??0,version:pos.version},nextCursor:page.LastEvaluatedKey?Buffer.from(JSON.stringify(page.LastEvaluatedKey)).toString('base64url'):null,operationalWalletChanged:false};
 }
 if(method!=='POST'||!actions.has(input.action)||!uuid(input.requestId))fail('CORRECTION_INVALID_REQUEST',400);
 const digest=hash(input),eventKey=key(branch,'EVENT#'+input.requestId),prior=await get(db,P,eventKey);
 if(prior){if(prior.requestDigest!==digest||prior.actorId!==a.actor||prior.ownerId!==a.b.ownerId)fail('CORRECTION_REQUEST_CONFLICT');return {...prior.receipt,replayed:true};}
 const at=new Date().toISOString();
 if(['LINK_CORRECTION_CASE','COMPLETE_CORRECTION_CASE'].includes(input.action)){
  if(Object.keys(input).some(k=>!['action','branchId','requestId','orderId','caseId','caseKey','caseVersion','correctionId','appealId','reason'].includes(k))||!id(input.orderId)||!id(input.caseId)||!(/^(RETURN#[1-9][0-9]{0,2}|CUSTOMER_CANCELLATION|MERCHANT_CANCELLATION)$/.test(input.caseKey||''))||!Number.isSafeInteger(input.caseVersion)||input.caseVersion<1||!text(input.reason,5,1000)||input.action==='LINK_CORRECTION_CASE'&&!uuid(input.correctionId)||input.appealId!==undefined&&!uuid(input.appealId))fail('CORRECTION_INVALID_REQUEST',400);
  const fresh=await access(true,true,0);if(fresh.actor!==a.actor||hash(fresh.guards)!==hash(a.guards))fail('CORRECTION_AUTHORIZATION_CHANGED');
  const result=await require('./merchant-correction-cases')({db:ctx.caseDb||db,input,branch,ownerId:a.b.ownerId,actorId:a.actor,at,hash,check,put,fail});
  const event={...eventKey,kind:'MERCHANT_CORRECTION_EVENT',ownerId:a.b.ownerId,actorId:a.actor,requestDigest:digest,receipt:result.receipt,createdAt:at};
  await db.send(new TransactWriteCommand({TransactItems:[...fresh.guards,...result.ops,put(event),{Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:'CORRECTION_CASE#'+input.requestId,logId:input.requestId,actorId:a.actor,action:input.action,branchId:branch,orderId:input.orderId,caseId:input.caseId,reason:input.reason.trim(),createdAt:at,financialPosting:false},ConditionExpression:'attribute_not_exists(sk)'}}]}));return result.receipt;
 }
 if(input.action==='SET_CORRECTION_POLICY'){
  if(Object.keys(input).some(k=>!['action','branchId','requestId','baseVersion','recoveryMode','reason'].includes(k))||!Number.isSafeInteger(input.baseVersion)||!['OFFSET_NEXT_SETTLEMENT','MANUAL_COLLECTION'].includes(input.recoveryMode)||!text(input.reason,5,1000))fail('CORRECTION_INVALID_REQUEST',400);
  const oldPolicy=await get(db,P,policyKey);if((oldPolicy?.version??0)!==input.baseVersion)fail('CORRECTION_STATE_CHANGED');
  const fresh=await access(true,true,0);if(fresh.actor!==a.actor||hash(fresh.guards)!==hash(a.guards))fail('CORRECTION_AUTHORIZATION_CHANGED');
  const policy={...policyKey,kind:'MERCHANT_CORRECTION_POLICY',version:input.baseVersion+1,recoveryMode:input.recoveryMode,applyCredits:true,updatedAt:at,updatedBy:a.actor,reason:input.reason.trim()};const receipt={policy:{version:policy.version,recoveryMode:policy.recoveryMode,applyCredits:true,persisted:true}};
  const audit={datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:'CORRECTION_POLICY#'+input.requestId,logId:input.requestId,actorId:a.actor,action:input.action,createdAt:at,reason:input.reason.trim(),before:oldPolicy||null,after:policy};
  await db.send(new TransactWriteCommand({TransactItems:[...fresh.guards,put(policy,oldPolicy),put({...eventKey,kind:'MERCHANT_CORRECTION_EVENT',ownerId:a.b.ownerId,actorId:a.actor,requestDigest:digest,receipt,createdAt:at}),{Put:{TableName:'staging-AuditLog',Item:audit,ConditionExpression:'attribute_not_exists(sk)'}}]}));return receipt;
 }
 let row,old,ops=[],approve=false,amount=0;
 async function proof(orderId){
  const pk={orderId,sk:'MERCHANT_PAYABLE'},payable=await get(db,H,pk);
  if(!payable||payable.orderId!==orderId||payable.branchId!==branch||payable.status!=='PAID'||!Number.isSafeInteger(payable.amount)||payable.amount<=0)fail('CORRECTION_PAID_SOURCE_REQUIRED');
  const jk={pk:'MERCHANT_PAYOUT_PAID#'+payable.paidPayoutId,sk:'META'},journal=await get(db,P,jk);runtime.verifyMerchantPayoutJournal(journal,branch,payable);
  if(journal.ownerId!==a.b.ownerId)fail('CORRECTION_OWNER_CHANGED');return {payable,journal,guards:[check(H,pk,payable),check(P,jk,journal)]};
 }
 if(input.action==='REQUEST_SETTLEMENT_CORRECTION'){
  if(Object.keys(input).some(k=>!['action','branchId','requestId','orderId','direction','amountIqd','reference','reason'].includes(k))||!id(input.orderId)||!['CREDIT','DEBIT'].includes(input.direction)||!Number.isSafeInteger(input.amountIqd)||input.amountIqd<=0||!text(input.reason,5,1000)||!text(input.reference,3,200))fail('CORRECTION_INVALID_REQUEST',400);
  const source=await proof(input.orderId);if(input.amountIqd>source.payable.amount)fail('CORRECTION_EXCEEDS_ORIGINAL_PAID');
  row={...key(branch,'REQUEST#'+input.requestId),kind:'MERCHANT_SETTLEMENT_CORRECTION',correctionId:input.requestId,branchId:branch,ownerId:a.b.ownerId,orderId:input.orderId,originalPayoutId:source.payable.paidPayoutId,originalBatchId:source.payable.settlementBatchId,originalPaidIqd:source.payable.amount,sourceDigest:hash({payable:source.payable,journal:source.journal}),direction:input.direction,amountIqd:input.amountIqd,reference:input.reference.trim(),reason:input.reason.trim(),status:'PENDING_APPROVAL',version:1,requestedBy:a.actor,requestDigest:digest,createdAt:at};ops.push(...source.guards,put(row));
 }else{
  if(Object.keys(input).some(k=>!['action','branchId','requestId','correctionId','version','reason'].includes(k))||!uuid(input.correctionId)||!Number.isSafeInteger(input.version)||!text(input.reason,5,1000))fail('CORRECTION_INVALID_REQUEST',400);
  old=await get(db,P,key(branch,'REQUEST#'+input.correctionId));if(!old||old.branchId!==branch||old.ownerId!==a.b.ownerId||old.version!==input.version||old.status!=='PENDING_APPROVAL')fail('CORRECTION_STATE_CHANGED');
  approve=true;amount=old.amountIqd;const source=await proof(old.orderId);if(hash({payable:source.payable,journal:source.journal})!==old.sourceDigest)fail('CORRECTION_PAID_PROOF_CHANGED');ops.push(...source.guards);
  const posting=input.action==='APPROVE_SETTLEMENT_CORRECTION';row={...old,status:posting?'POSTED':'REJECTED',version:old.version+1,decidedBy:a.actor,decisionReason:input.reason.trim(),decidedAt:at};
  if(posting){
   const policy=await get(db,P,policyKey);if(!policy)ops.push(put({...policyKey,kind:'MERCHANT_CORRECTION_POLICY',version:1,recoveryMode:'OFFSET_NEXT_SETTLEMENT',applyCredits:true,updatedAt:at,updatedBy:a.actor,reason:'السياسة الافتراضية المعتمدة: الخصم من التسويات القادمة وترحيل المتبقي'}));
   const oldPos=await get(db,P,key(branch,'POSITION')),pos=position(oldPos,branch,a.b.ownerId),ok=key(branch,'ORDER#'+old.orderId),orderPos=await get(db,P,ok);
   if(orderPos&&(orderPos.ownerId!==a.b.ownerId||orderPos.originalPayoutId!==old.originalPayoutId||orderPos.sourceDigest!==old.sourceDigest))fail('CORRECTION_PAID_PROOF_CHANGED');
   const field=old.direction==='CREDIT'?'creditIqd':'debtIqd',sum=(orderPos?.[field]||0)+amount;if(!Number.isSafeInteger(sum)||sum>old.originalPaidIqd)fail('CORRECTION_EXCEEDS_ORIGINAL_PAID');
   const total=pos[field]+amount;if(!Number.isSafeInteger(total)||total>1000000000000)fail('CORRECTION_POSITION_LIMIT');
   const lines=old.direction==='CREDIT'?[{account:'MERCHANT_CORRECTION_EXPENSE',side:'DEBIT',amountIqd:amount},{account:'MERCHANT_CORRECTION_PAYABLE',side:'CREDIT',amountIqd:amount,dimension:branch}]:[{account:'MERCHANT_CORRECTION_RECEIVABLE',side:'DEBIT',amountIqd:amount,dimension:branch},{account:'MERCHANT_CORRECTION_RECOVERY',side:'CREDIT',amountIqd:amount}];
   const body={...key(branch,'JOURNAL#'+old.correctionId),kind:'MERCHANT_POST_PAYOUT_CORRECTION_JOURNAL',status:'POSTED',schemaVersion:1,branchId:branch,ownerId:a.b.ownerId,correctionId:old.correctionId,orderId:old.orderId,originalPayoutId:old.originalPayoutId,originalBatchId:old.originalBatchId,sourceDigest:old.sourceDigest,requestDigest:old.requestDigest,direction:old.direction,amountIqd:amount,lines,debitIqd:amount,creditIqd:amount,actorId:a.actor,reason:input.reason.trim(),createdAt:at};
   ops.push(put({...body,digest:hash(body)}),put({...pos,[field]:total,version:pos.version+1,updatedAt:at},oldPos),put({...ok,kind:'MERCHANT_CORRECTION_ORDER_TOTALS',branchId:branch,ownerId:a.b.ownerId,originalPayoutId:old.originalPayoutId,sourceDigest:old.sourceDigest,creditIqd:orderPos?.creditIqd||0,debtIqd:orderPos?.debtIqd||0,[field]:sum,version:(orderPos?.version||0)+1},orderPos));
  }
  ops.push(put(row,old));
 }
 const fresh=await access(true,approve,amount);if(fresh.actor!==a.actor||hash(fresh.b)!==hash(a.b)||hash(fresh.guards)!==hash(a.guards))fail('CORRECTION_AUTHORIZATION_CHANGED');
 const receipt={correction:present(row),operationalWalletChanged:false,payoutPerformed:false};
 ops.push(put({...eventKey,kind:'MERCHANT_CORRECTION_EVENT',ownerId:a.b.ownerId,actorId:a.actor,requestDigest:digest,receipt,createdAt:at}));
 ops.push({Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:'CORRECTION#'+input.requestId,logId:input.requestId,actorId:a.actor,action:input.action,branchId:branch,correctionId:row.correctionId,amountIqd:row.amountIqd,reason:input.reason.trim(),createdAt:at},ConditionExpression:'attribute_not_exists(sk)'}});
 try{await db.send(new TransactWriteCommand({TransactItems:[...fresh.guards,...ops]}));}catch(e){const saved=await get(db,P,eventKey);if(saved?.requestDigest===digest&&saved.actorId===a.actor&&saved.ownerId===a.b.ownerId)return {...saved.receipt,replayed:true};if(e.name==='TransactionCanceledException')fail('CORRECTION_STATE_CHANGED');throw e;}
 return receipt;
}
module.exports={matches,route};
