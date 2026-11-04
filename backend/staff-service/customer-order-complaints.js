'use strict';
// A post-delivery case in the existing exceptions inbox, linked to the existing
// authenticated support conversation. No order status, wallet or payout writes.
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {hash,exact}=require('./dispatch-followup-core');
const {allowed}=require('./catalog');
const KEY='CUSTOMER_POST_DELIVERY',H='staging-Holds',O='WizzOrders',S='chat-sessions-staging';
const TYPES=['MISSING_ITEMS','WRONG_ITEMS','QUALITY','NOT_DELIVERED','SAFETY','OTHER'];
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,149}$/.test(v);
const text=(v,max=2000)=>typeof v==='string'&&v.trim().length>=5&&v.length<=max;
const fail=(code='COMPLAINT_CHANGED',status=409)=>{throw Object.assign(Error(code),{code,status});};
const get=async(db,t,k)=>(await db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;
const decision=row=>row.decisions?.at(-1)??null;
function publicView(row,policy,now){
 const d=row&&decision(row);
 return {success:true,caseKey:KEY,caseId:row?.caseId??null,orderId:row?.orderId,version:row?.version??0,status:row?.state??'NOT_OPENED',type:row?.type??null,description:row?.description??null,evidence:(row?.evidence??[]).filter(e=>e.source==='CUSTOMER').map(e=>Object.fromEntries(['id','kind','text','attachmentId','sessionId','at'].filter(k=>e[k]!==undefined).map(k=>[k,e[k]]))),customerRequest:row?.customerRequest??null,supportSessionId:row?.supportSessionId??null,createdAt:row?.createdAt??null,responseDueAt:row?.activePhase?.responseDueAt??null,decision:d?{decisionId:d.decisionId,outcome:d.outcome,reason:d.publicReason,remedyAmountIqd:d.remedyAmountIqd,remedyKind:d.remedyAmountIqd?'FUTURE_GOODS_DISCOUNT':'NONE',decidedAt:d.at,acknowledgedAt:row.decisionAcknowledgements?.[d.decisionId]??null}:null,appeal:row?.appeals?.at(-1)?{status:row.appeals.at(-1).status,reason:row.appeals.at(-1).reason,submittedAt:row.appeals.at(-1).at}:null,appealWindowSeconds:(row?.casePolicySnapshot??policy).values.appealSeconds,canAppeal:!!d&&!!row.decisionAcknowledgements?.[d.decisionId]&&!row.appeals?.some(a=>a.decisionId===d.decisionId)&&(!row.decisionAcknowledgements?.[d.decisionId]||now<=Date.parse(row.decisionAcknowledgements[d.decisionId])+(row.casePolicySnapshot.values.appealSeconds*1000)),cashRefundPerformed:false,financialPosting:false};
}
function createCustomerOrderComplaints({db,authenticate,authorizeStaff,policy,index,phase,now=Date.now,verifyVoucher}){
 async function context(orderId){
  if(!id(orderId))fail('INVALID_COMPLAINT',400);
  const actor=await authenticate(),ok={PK:'ORDER#'+orderId,SK:'META'},order=await get(db,O,ok);
  if(!order||order.orderId!==orderId||!['delivered','completed'].includes(order.status)||order.isGuestOrder===true||order.deletedAt!=null||order.deletionRequestId!=null||order.isDeleted===true||!id(order.userSub)||!id(order.storeId))fail('COMPLAINT_UNAVAILABLE',404);
  if(actor.kind!=='STAFF'&&(actor.kind!=='CUSTOMER'||actor.subjectId!==order.userSub))fail('COMPLAINT_FORBIDDEN',403);
  const guards=[exact(O,ok,order,['orderId','status','userSub','userId','storeId','driverId','deliveredAt','completedAt','updatedAt','isGuestOrder','deletedAt','deletionRequestId','isDeleted'])];
  for(const pk of ['ORDER_LIFECYCLE#'+orderId,'ACCOUNT_LIFECYCLE#CUSTOMER#'+order.userSub]){
   const key={pk,sk:'META'};if(await get(db,'staging-AccountDeletion',key))fail('COMPLAINT_UNAVAILABLE',404);guards.push(exact('staging-AccountDeletion',key,null,['pk']));
  }
  const profileKey={userId:order.userId??order.userSub},profile=await get(db,'WizzUser_users_staging',profileKey);
  if(!profile||profile.isActive===false||profile.deletedAt!=null||profile.deletionRequestId!=null||profile.isDeleted===true||(profile.cognitoSub??profile.userId)!==order.userSub)fail('COMPLAINT_UNAVAILABLE',404);
  guards.push(exact('WizzUser_users_staging',profileKey,profile));
  const access=actor.kind==='STAFF'?await authorizeStaff(actor,order,'READ'):null;if(access)guards.push(access.guard);
  const ck={orderId,sk:KEY},row=await get(db,H,ck),caseId='OEX:'+hash({orderId,kind:KEY}).slice(0,48);
  if(row&&(row.kind!=='CUSTOMER_POST_DELIVERY_CASE'||row.caseId!==caseId||row.customerId!==order.userSub||row.branchId!==order.storeId||!Number.isSafeInteger(row.version)))fail('COMPLAINT_UNAVAILABLE',404);
  if(row){const session=await get(db,S,{sessionId:row.supportSessionId});if(!session||session.userType!=='customer'||session.customerId!==order.userSub||session.orderId!==orderId||session.complaintCaseId!==caseId)fail('COMPLAINT_SUPPORT_CHANGED');}
  const p=row?{snapshot:row.casePolicySnapshot}:await policy();if(row)phase(row.casePolicySnapshot,row.type==='SAFETY'?'SAFETY':'STANDARD',row.createdAt);return {actor,order,guards,access,ck,row,caseId,p};
 }
 async function execute(v){
  if(!v||typeof v!=='object'||Array.isArray(v)||!id(v.orderId)||typeof v.action!=='string')fail('INVALID_COMPLAINT',400);
  const customer=['READ','OPEN','ADD_MESSAGE','ADD_IMAGE','ACK_DECISION','APPEAL'],staff=['READ','CLAIM','RELEASE','ADD_EVIDENCE','REQUEST_INFO','DECIDE','RESOLVE_APPEAL','CLOSE'];
  const c=await context(v.orderId),isStaff=c.actor.kind==='STAFF';
  if(!(isStaff?staff:customer).includes(v.action))fail('COMPLAINT_FORBIDDEN',403);
  const common=['orderId','action'],extra={READ:[],OPEN:['type','reason'],ADD_MESSAGE:['reason'],ADD_IMAGE:['attachmentId','reason'],ACK_DECISION:['decisionId'],APPEAL:['decisionId','reason'],CLAIM:['reason'],RELEASE:['reason'],ADD_EVIDENCE:['reportedBy','reference','reason'],REQUEST_INFO:['reason'],DECIDE:['outcome','publicReason','reason','evidenceIds','allocations','remedyAmountIqd'],RESOLVE_APPEAL:['reason','publicReason','outcome','evidenceIds','allocations','remedyAmountIqd'],CLOSE:['reason']}[v.action];
  if(!extra||Object.keys(v).sort().join(',')!==[...common,...(v.action==='READ'?[]:['expectedVersion','requestId']),...extra].sort().join(','))fail('INVALID_COMPLAINT',400);
  if(v.action==='READ')return {...publicView(c.row,c.p.snapshot,now()),orderId:v.orderId,...(!c.row?{claimWindowSeconds:c.p.snapshot.values.postDeliveryClaimSeconds,canOpen:claimTime(c.order,c.p.snapshot,now()),safetyReportAllowed:true}:{}),...(isStaff?{case:c.row}:{} )};
  if(!uuid(v.requestId)||!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<0||v.action!=='ACK_DECISION'&&!text(v.reason))fail('INVALID_COMPLAINT',400);
  const eventKey={orderId:v.orderId,sk:'POST_DELIVERY_EVENT#'+v.requestId},digest=hash({input:v,actor:c.actor}),prior=await get(db,H,eventKey);
  if(prior){if(prior.requestDigest!==digest)fail('COMPLAINT_REQUEST_CONFLICT');return {...prior.receipt,replayed:true};}
  if((c.row?.version??0)!==v.expectedVersion)fail();
  if(!c.row&&v.action!=='OPEN')fail('COMPLAINT_UNAVAILABLE',404);
  if(c.row&&v.action==='OPEN')fail('COMPLAINT_ALREADY_OPEN');
  const at=new Date(now()).toISOString(),guards=[...c.guards],ops=[],data=structuredClone(c.row??{});
  if(isStaff){const access=await authorizeStaff(c.actor,c.order,'OPERATE');guards.push(access.guard);c.staffAccess=access;if(v.action!=='CLAIM'&&data.ownerId!==c.actor.subjectId)fail('COMPLAINT_CLAIM_REQUIRED');}
  if(v.action==='OPEN'){
   if(!TYPES.includes(v.type))fail('INVALID_COMPLAINT',400);
   if(v.type!=='SAFETY'&&!claimTime(c.order,c.p.snapshot,now()))fail('COMPLAINT_WINDOW_EXPIRED');
   const sessionId='complaint_'+hash({caseId:c.caseId,customerId:c.order.userSub}).slice(0,48),session=await get(db,S,{sessionId});
   if(session&&(session.userType!=='customer'||session.customerId!==c.order.userSub||session.orderId!==v.orderId||session.complaintCaseId!==c.caseId||session.status==='closed'))fail('COMPLAINT_SUPPORT_CHANGED');
   if(session)guards.push(exact(S,{sessionId},session));else ops.push({Put:{TableName:S,Item:{sessionId,userId:c.order.userSub,customerId:c.order.userSub,userType:'customer',source:'wizzuser_app',orderId:v.orderId,complaintCaseId:c.caseId,status:'waiting_for_agent',customerName:'زبون الطلب',userDisplayName:'شكوى طلب مسلّم',createdAt:at},ConditionExpression:'attribute_not_exists(sessionId)'}});
   Object.assign(data,{...c.ck,kind:'CUSTOMER_POST_DELIVERY_CASE',schemaVersion:1,caseId:c.caseId,customerId:c.order.userSub,branchId:c.order.storeId,driverId:c.order.driverId??null,state:'OPEN',type:v.type,description:v.reason.trim(),supportSessionId:sessionId,casePolicySnapshot:c.p.snapshot,activePhase:phase(c.p.snapshot,v.type==='SAFETY'?'SAFETY':'STANDARD',at),createdAt:at,evidence:[],decisions:[],appeals:[],ownerId:null,exceptionResolution:{caseId:c.caseId,type:KEY,status:'OPEN',allegedReason:v.reason.trim(),responsibility:'UNDETERMINED'}});guards.push(c.p.condition);
   data.evidence.push({id:v.requestId,source:'CUSTOMER',actorId:c.actor.subjectId,kind:'CUSTOMER_REPORT',text:v.reason.trim(),at});
  }else if(v.action==='ACK_DECISION'){
   if(decision(data)?.decisionId!==v.decisionId)fail();
   data.decisionAcknowledgements={...data.decisionAcknowledgements,[v.decisionId]:data.decisionAcknowledgements?.[v.decisionId]??at};
  }else if(v.action==='APPEAL'){
   const d=decision(data),ack=data.decisionAcknowledgements?.[v.decisionId];
   if(!ack||d?.decisionId!==v.decisionId||data.appeals.some(a=>a.decisionId===v.decisionId)||ack&&now()>Date.parse(ack)+data.casePolicySnapshot.values.appealSeconds*1000)fail('COMPLAINT_APPEAL_UNAVAILABLE');
   if(data.appeals.length>=10)fail('COMPLAINT_HISTORY_LIMIT');
   data.appeals.push({appealId:v.requestId,decisionId:d.decisionId,status:'OPEN',reason:v.reason.trim(),at});data.state='APPEAL_REVIEW';data.activePhase=phase(data.casePolicySnapshot,data.type==='SAFETY'?'SAFETY':'STANDARD',at);data.exceptionResolution.status='OPEN';
  }else{
   if(data.state==='CLOSED')fail('COMPLAINT_CLOSED');
   if(v.action==='CLAIM'){
    if(data.ownerId&&data.ownerId!==c.actor.subjectId){const key={pk:'EMPLOYEE#'+data.ownerId,sk:'PROFILE'},owner=await get(db,'staging-PlatformStaff',key);if(owner?.status==='ACTIVE'&&owner.scope?.allRegions===true&&(allowed(owner,'orders.cancel')||allowed(owner,'finance.approve')))fail('COMPLAINT_OWNED_BY_OTHER');guards.push(exact('staging-PlatformStaff',key,owner,owner?Object.keys(owner):['pk']));}
    data.ownerId=c.actor.subjectId;data.ownerName=c.staffAccess?.employee?.displayName??c.staffAccess?.employee?.name??'مسؤول المراجعة';data.state=data.state==='OPEN'?'IN_REVIEW':data.state;
   }else if(v.action==='RELEASE'){data.ownerId=null;data.ownerName=null;
   }else if(['ADD_MESSAGE','ADD_IMAGE','ADD_EVIDENCE'].includes(v.action)){
    if(data.evidence.length>=100)fail('COMPLAINT_HISTORY_LIMIT');
    const evidence={id:v.requestId,source:isStaff?v.reportedBy:'CUSTOMER',actorId:c.actor.subjectId,kind:v.action,text:v.reason.trim(),at};
    if(v.action==='ADD_EVIDENCE'){
     if(!['CUSTOMER','MERCHANT','DRIVER','SYSTEM','EXTERNAL'].includes(v.reportedBy)||typeof v.reference!=='string'||v.reference.trim().length<3||v.reference.length>500)fail('INVALID_COMPLAINT',400);
     evidence.reference=v.reference.trim();evidence.recordedAsReported=true;
    }else if(v.action==='ADD_IMAGE'){
     if(!uuid(v.attachmentId))fail('INVALID_COMPLAINT',400);
     if(data.evidence.some(e=>e.attachmentId===v.attachmentId&&e.actorId===c.actor.subjectId))return {success:true,orderId:v.orderId,caseId:c.caseId,version:c.row.version,status:c.row.state,action:v.action,replayed:true,financialPosting:false};
     const key={attachmentId:v.attachmentId},image=await get(db,'support-attachments-staging',key);
     if(!image||image.subjectId!==c.actor.subjectId||image.userType!=='customer'||image.sessionId!==data.supportSessionId||image.status!=='PUBLISHED'||!Number.isFinite(image.ttl)||image.ttl<=now()/1000||!image.checksum)fail('COMPLAINT_IMAGE_UNAVAILABLE');
     const mk={sessionId:image.sessionId,messageKey:image.messageKey},message=image.messageKey?await get(db,'chat-messages-staging',mk):null;if(!message||message.attachment?.attachmentId!==image.attachmentId)fail('COMPLAINT_IMAGE_UNAVAILABLE');guards.push(exact('chat-messages-staging',mk,message));
     evidence.attachmentId=image.attachmentId;evidence.sessionId=image.sessionId;evidence.checksum=image.checksum;evidence.contentType=image.contentType;guards.push(exact('support-attachments-staging',key,image));
    }
    data.evidence.push(evidence);if(data.state==='WAITING_CUSTOMER')data.state='IN_REVIEW';
   }else if(v.action==='REQUEST_INFO'){
    if(data.state==='APPEAL_REVIEW')fail('COMPLAINT_APPEAL_REVIEW_REQUIRED');data.state='WAITING_CUSTOMER';data.customerRequest={text:v.reason.trim(),at};
   }else if(['DECIDE','RESOLVE_APPEAL'].includes(v.action)){
    const appeal=data.appeals.at(-1);
    if(v.action==='RESOLVE_APPEAL'?appeal?.status!=='OPEN':data.state==='APPEAL_REVIEW')fail('COMPLAINT_APPEAL_REVIEW_REQUIRED');
    if(!['ACCEPTED','REJECTED','UNDETERMINED'].includes(v.outcome)||!text(v.publicReason)||!Array.isArray(v.evidenceIds)||!v.evidenceIds.length||v.evidenceIds.length>30||new Set(v.evidenceIds).size!==v.evidenceIds.length||!Number.isSafeInteger(v.remedyAmountIqd)||v.remedyAmountIqd<0||v.remedyAmountIqd>Math.floor(Number.MAX_SAFE_INTEGER/1000)||v.outcome!=='ACCEPTED'&&v.remedyAmountIqd!==0)fail('INVALID_COMPLAINT',400);
    const evidence=v.evidenceIds.map(id=>data.evidence.find(e=>e.id===id));if(evidence.some(x=>!x))fail('COMPLAINT_EVIDENCE_REQUIRED');
    if(!Array.isArray(v.allocations)||v.allocations.length>4)fail('INVALID_COMPLAINT',400);
    let sum=0;const parties=new Set();for(const a of v.allocations){if(!a||Object.keys(a).sort().join(',')!=='basisPoints,party'||!['CUSTOMER','MERCHANT','DRIVER','PLATFORM'].includes(a.party)||parties.has(a.party)||!Number.isSafeInteger(a.basisPoints)||a.basisPoints<1||a.basisPoints>10000)fail('INVALID_COMPLAINT',400);parties.add(a.party);sum+=a.basisPoints;}
    if(v.allocations.length&&(sum!==10000||new Set(evidence.map(e=>e.source)).size<2))fail('COMPLAINT_INDEPENDENT_EVIDENCE_REQUIRED');
    if(v.remedyAmountIqd>0){const access=await authorizeStaff(c.actor,c.order,'FINANCIAL',v.remedyAmountIqd);guards.push(access.guard);}
    const link=await verifyVoucher(c.order,data);guards.push(...link.guards);if(link.link&&v.remedyAmountIqd!==link.link.amountIqd)fail('COMPLAINT_REMEDY_ALREADY_RECORDED');
    if(data.decisions.length>=20)fail('COMPLAINT_HISTORY_LIMIT');
    data.decisions.push({decisionId:v.requestId,outcome:v.outcome,publicReason:v.publicReason.trim(),internalReason:v.reason.trim(),evidenceIds:v.evidenceIds,allocations:v.allocations,remedyAmountIqd:v.remedyAmountIqd,actorId:c.actor.subjectId,at,noAutomaticCharge:true});
    if(v.action==='RESOLVE_APPEAL'){appeal.status='RESOLVED';appeal.resolvedAt=at;appeal.resolutionDecisionId=v.requestId;}
    data.state=v.remedyAmountIqd&&!link.link?'REMEDY_PENDING':'DECIDED';data.exceptionResolution.responsibility=v.allocations.length===1?v.allocations[0].party:v.allocations.length?'SHARED':'UNDETERMINED';
   }else if(v.action==='CLOSE'){
    const d=decision(data);if(!d||data.state==='APPEAL_REVIEW'||data.appeals.some(a=>a.status==='OPEN'))fail('COMPLAINT_DECISION_REQUIRED');
    const remedy=await verifyVoucher(c.order,data);guards.push(...remedy.guards);
    if(d.remedyAmountIqd>0&&(!remedy.link||remedy.link.amountIqd!==d.remedyAmountIqd||!remedy.valid))fail('COMPLAINT_REMEDY_REQUIRED');
    data.state='CLOSED';data.closedAt=at;data.closedBy=c.actor.subjectId;data.exceptionResolution.status='RESOLVED';
   }
  }
  if(isStaff&&data.activePhase&&!data.activePhase.respondedAt)data.activePhase={...data.activePhase,respondedAt:at,responseSource:'ADMIN_REVIEW'};
  data.version=(c.row?.version??0)+1;data.updatedAt=at;if(!Number.isSafeInteger(data.version)||Buffer.byteLength(JSON.stringify(data))>300000)fail('COMPLAINT_HISTORY_LIMIT');
  const receipt={success:true,orderId:v.orderId,caseId:c.caseId,version:data.version,status:data.state,action:v.action,financialPosting:false};
  const {TableName,Key,...condition}=exact(H,c.ck,c.row,c.row?Object.keys(c.row):['orderId']).ConditionCheck;
  ops.push(...guards,{Put:{TableName:H,Item:data,...condition}},{Put:{TableName:H,Item:{...eventKey,kind:'POST_DELIVERY_COMPLAINT_EVENT',caseId:c.caseId,requestDigest:digest,actorId:c.actor.subjectId,actorKind:c.actor.kind,action:v.action,at,receipt},ConditionExpression:'attribute_not_exists(orderId)'}},await index({caseId:c.caseId,orderId:v.orderId,caseKey:KEY,caseType:'CUSTOMER_POST_DELIVERY_CASE',state:data.state,open:data.state!=='CLOSED',at,branchId:c.order.storeId,dueAt:data.activePhase?.responseDueAt??at}));
  if(JSON.stringify(await authenticate())!==JSON.stringify(c.actor))fail('UNAUTHORIZED',401);
  try{await db.send(new TransactWriteCommand({TransactItems:dedup(ops)}));}catch(e){const replay=await get(db,H,eventKey);if(replay?.requestDigest===digest)return {...replay.receipt,replayed:true};if(e.name==='TransactionCanceledException')fail();throw e;}
  return receipt;
 }
 return {execute};
}
function claimTime(order,policy,now){const t=Date.parse(order.deliveredAt??order.completedAt);return Number.isFinite(t)&&t<=now+30000&&now<=t+policy.values.postDeliveryClaimSeconds*1000;}
function dedup(ops){const seen=new Map(),result=[];for(const op of ops){const q=op.ConditionCheck??op.Put??op.Update,k=q.TableName+'|'+JSON.stringify(q.Key??Object.fromEntries(Object.entries(q.Item).filter(([k])=>['pk','sk','orderId','SK','PK','sessionId','userId','operationId'].includes(k))));if(op.ConditionCheck&&seen.has(k)){if(JSON.stringify(op)!==JSON.stringify(seen.get(k)))fail('COMPLAINT_AUTHORITY_CHANGED');continue;}seen.set(k,op);result.push(op);}return result;}
module.exports={KEY,TYPES,createCustomerOrderComplaints,publicView,claimTime};
