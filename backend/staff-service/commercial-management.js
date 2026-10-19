'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash}=require('node:crypto');
const {allowed}=require('./catalog');
const {validateCommercialCharge}=require('./pricing-runtime/orderCommercialPricing');
const {parseIqd,readWholeIqdRounding}=require('./pricing-runtime/money');
const {deliveryCampaignBudgetInitialization}=require('./pricing-runtime/deliveryCampaignBudget');
const {readDeliveryFundingPolicy}=require('./pricing-runtime/deliveryFundingPolicy');
const workflow=require('./write-workflow');const direct=()=>workflow.direct?.()===true;
const P='staging-MerchantPlatform',S='staging-PlatformStaff',B='WhizzMerchants_Businesses',L='staging-AccountDeletion';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{status});};
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const copy=v=>JSON.parse(JSON.stringify(v));
function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))fail('INVALID_COMMERCIAL_REQUEST');return v;}
function id(v){if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v))fail('INVALID_COMMERCIAL_ID');return v;}
function version(v){if(!Number.isSafeInteger(v)||v<0||v>=Number.MAX_SAFE_INTEGER)fail('INVALID_VERSION');return v;}
function date(v){if(typeof v!=='string'||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)fail('INVALID_COMMERCIAL_PERIOD');return v;}
function period(from,to){date(from);if(to!==null&&(date(to),to<=from))fail('INVALID_COMMERCIAL_PERIOD');}
function pin(table,key,row,fields=Object.keys(row)){
 const names={},values={},conditions=[];
 fields.forEach((k,i)=>{names['#f'+i]=k;if(row[k]===undefined)conditions.push('attribute_not_exists(#f'+i+')');else{values[':f'+i]=copy(row[k]);conditions.push('#f'+i+'=:f'+i);}});
 return {TableName:table,Key:key,ConditionExpression:conditions.join(' AND '),ExpressionAttributeNames:names,...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})};
}
const check=(table,key,row,fields)=>({ConditionCheck:pin(table,key,row,fields)});
const condition=row=>row?{ConditionExpression:'#v=:v AND #h=:h',ExpressionAttributeNames:{'#v':'version','#h':'hash'},ExpressionAttributeValues:{':v':row.version,':h':row.hash}}:{ConditionExpression:'attribute_not_exists(pk)'};
const leaseFences=(owner,ids)=>['ACCOUNT_LIFECYCLE#MERCHANT#'+owner,...ids.map(b=>'BUSINESS_LIFECYCLE#MERCHANT#'+b)].map(pk=>({ConditionCheck:{TableName:L,Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}}));
function agreementValues(v){
 exact(v,['scope','effectiveFrom','effectiveTo','commission','serviceFee','allowedFundingPolicyIds']);
 if(!['MERCHANT','BRANCH'].includes(v.scope))fail('INVALID_COMMERCIAL_SCOPE');period(v.effectiveFrom,v.effectiveTo);
 if(!Array.isArray(v.allowedFundingPolicyIds)||v.allowedFundingPolicyIds.length>20||new Set(v.allowedFundingPolicyIds).size!==v.allowedFundingPolicyIds.length)fail('INVALID_FUNDING_POLICIES');v.allowedFundingPolicyIds.forEach(id);if(v.allowedFundingPolicyIds.length)fail('FUNDING_SEPARATE_FROM_AGREEMENT');
 let commission,serviceFee;try{commission=validateCommercialCharge(v.commission);serviceFee=validateCommercialCharge(v.serviceFee);}catch{fail('INVALID_COMMERCIAL_CHARGE');}
 for(const c of [commission,serviceFee])if(!c.finalRounding||c.finalRounding.incrementIqd!==1)fail('WHOLE_IQD_CHARGE_POLICY_REQUIRED');
 return {...copy(v),commission,serviceFee};
}
function fundingValues(v){
 exact(v,['campaignId','campaignVersion','source','effectiveFrom','effectiveTo','merchantNumerator','denominator','merchantShareFinalRounding']);
 id(v.campaignId);if(version(v.campaignVersion)<1||!['MERCHANT','PLATFORM'].includes(v.source))fail('INVALID_FUNDING_POLICY');period(v.effectiveFrom,v.effectiveTo);if(v.effectiveTo===null)fail('FUNDING_END_REQUIRED');
 if(!Number.isSafeInteger(v.denominator)||v.denominator<1||!Number.isSafeInteger(v.merchantNumerator)||v.merchantNumerator<=0||v.merchantNumerator>=v.denominator)fail('INVALID_FUNDING_SHARE');
 let f;try{f=readWholeIqdRounding(v.merchantShareFinalRounding);}catch{fail('INVALID_FUNDING_SHARE');}if(f.mode!=='TOWARD_ZERO')fail('INVALID_FUNDING_SHARE');
 return copy(v);
}
async function serviceCore(ctx,principal,method,input){
 if(ctx.enabled!==true)fail('COMMERCIAL_MANAGEMENT_DISABLED',503);
 if(!input||typeof input!=='object'||Array.isArray(input)||Buffer.byteLength(JSON.stringify(input))>65536)fail('INVALID_COMMERCIAL_REQUEST');
 if(!['OWNER','STAFF'].includes(principal?.kind))fail('UNAUTHORIZED',401);
 const owner=principal.kind==='OWNER',actor=principal.actor;
 if(!owner&&(!allowed(actor,'commercial.read')||actor.scope?.allRegions!==true))fail('PERMISSION_REQUIRED',403);
 if(method==='GET'&&input.view==='platform-events'){if(owner)fail('PERMISSION_REQUIRED',403);return require('./commercial-events').list(ctx,actor,input);}
 const get=async(t,k)=>(await ctx.db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;
 const b=await get(B,{businessId:id(input.businessId)});
 if(!b||b.deletionRequestId!=null||b.deletedAt!=null||b.isDeleted===true||b.ownerId!==b.cognitoUserId)fail('BUSINESS_UNAVAILABLE',404);
 const party=owner?await require('./commercial-party').resolve(ctx.db,b,principal.sub):null;
 if(party?.role==='MANAGER'&&method==='POST'&&!['ACCEPT_FUNDING','ACCEPT_DELIVERY'].includes(input.action))fail('PERMISSION_REQUIRED',403);
 id(b.organizationId);const org=await get(P,{pk:'PERSON#'+b.ownerId,sk:'ORGANIZATION#'+b.organizationId});
 if(!org||org.organizationId!==b.organizationId||org.subjectId!==b.ownerId||org.deletionRequestId!=null)fail('ORGANIZATION_UNAVAILABLE',409);
 const branchFields=['businessId','ownerId','cognitoUserId','organizationId','regionId','status','deletionRequestId','deletedAt','isDeleted','commercialAgreementId','commercialAgreementVersion','deliveryOfferRevision'];
 const baseGuards=[...(party?.guards||[]),...(!owner?[ctx.guard(actor)]:[]),...leaseFences(b.ownerId,[b.businessId]),check(B,{businessId:b.businessId},b,branchFields),check(P,{pk:org.pk,sk:org.sk},org)];
 const write=async tx=>{try{await ctx.db.send(new TransactWriteCommand({TransactItems:tx}));}catch(e){if(e.name==='TransactionCanceledException')fail('VERSION_OR_STATE_CONFLICT',409);throw e;}};
 const policies=async(values,ids,merchantId)=>{const resolved=[];for(const policyId of values.allowedFundingPolicyIds){const key={pk:'DISCOUNT_FUNDING#'+policyId,sk:'CURRENT'},policy=await get(S,key);if(!policy||policy.status!=='ACTIVE'||policy.merchantId!==merchantId||!ids.includes(policy.branchId))fail('FUNDING_POLICY_UNAVAILABLE',409);resolved.push(policy);}return resolved;};
 const verifyPolicies=async draft=>{if(['FUNDING','DELIVERY'].includes(draft.kind))return [];const resolved=await policies(draft.values,draft.businessIds,b.organizationId);if(hash(resolved)!==hash(draft.fundingPolicies||[]))fail('FUNDING_TERMS_CHANGED',409);return resolved;};
 const pendingOnly=method==='GET'&&owner&&input.view==='pending-sharing';
 if(method==='GET'&&input.view!==undefined&&!pendingOnly){
  if(owner)fail('PERMISSION_REQUIRED',403);exact(input,['businessId','view']);if(input.view==='delivery-options'){if(ctx.deliveryFundingEnabled!==true)fail('DELIVERY_FUNDING_MANAGEMENT_DISABLED',503);const regions=await require('./delivery-options').load(ctx.db);await write(baseGuards);return {regions,businessId:b.businessId,merchantId:b.organizationId};}if(input.view!=='funding-options')fail('INVALID_COMMERCIAL_REQUEST');
  const options=await require('./commercial-options').load(ctx.db,b.businessId);await write(baseGuards);return {options,businessId:b.businessId};
 }
 const campaignFor=async values=>{
  const table=values.source==='MERCHANT'?'WhizzMerchants_Discounts':'WizzCentral_Platform_Discounts',campaign=await get(table,{discountId:values.campaignId});
  if(!campaign||campaign.version!==values.campaignVersion||campaign.isDeleted||campaign.deletedAt||campaign.deletionRequestId||(values.source==='MERCHANT'&&campaign.businessId!==b.businessId))fail('CAMPAIGN_VERSION_REQUIRED',409);
  const targets=campaign.targetRestaurants?.length?campaign.targetRestaurants:campaign.allowedBusinessIds?.length?campaign.allowedBusinessIds:campaign.businessIds?.length?campaign.businessIds:campaign.businessId?[campaign.businessId]:[];
  if(!Array.isArray(targets)||values.source==='PLATFORM'&&targets.length&&!targets.includes(b.businessId))fail('COMMERCIAL_SCOPE_MISMATCH',403);
  let from,to;try{from=new Date(campaign.validFrom||campaign.valid_from||campaign.startDate).toISOString();to=new Date(campaign.validTo||campaign.valid_to||campaign.endDate).toISOString();}catch{fail('INVALID_COMMERCIAL_PERIOD');}
  if(from!==values.effectiveFrom||to!==values.effectiveTo)fail('CAMPAIGN_PERIOD_CHANGED',409);
  return {table,campaign};
 };
 const view=d=>d?{fundingPolicies:d.fundingPolicies||[],id:d.id,kind:d.kind,version:d.version,baseVersion:d.baseVersion,hash:d.hash,values:d.values,businessIds:d.businessIds,publishedVersion:d.publishedVersion||null,requestedBy:owner?undefined:d.requestedBy,createdAt:d.createdAt}:null;
 if(method==='GET'){
  exact(input,pendingOnly?['businessId','view']:['businessId']);const rows=[];const pk='BRANCH#'+b.businessId;let cursor,pages=0;
  do{const p=await ctx.db.send(new QueryCommand({TableName:P,KeyConditionExpression:'pk=:pk AND begins_with(sk,:p)',ExpressionAttributeValues:{':pk':pk,':p':'COMMERCIAL#'},ConsistentRead:true,Limit:25,...(cursor?{ExclusiveStartKey:cursor}:{})}));rows.push(...p.Items||[]);cursor=p.LastEvaluatedKey;if(++pages>4||rows.length>100||cursor&&rows.length>=100)fail('COMMERCIAL_LIST_TOO_LARGE',409);}while(cursor);
  const items=[];
  for(const index of rows){if(pendingOnly&&!['FUNDING','DELIVERY'].includes(index.kind))continue;if(index.kind==='DELIVERY'&&ctx.deliveryFundingEnabled!==true)continue;if(index.ownerId!==b.ownerId||party?.role==='MANAGER'&&!['FUNDING','DELIVERY'].includes(index.kind))continue;const table=index.kind==='AGREEMENT'?P:S,pk=index.recordPk,d=await get(table,{pk,sk:'DRAFT'});if(!d||d.ownerId!==b.ownerId||!d.businessIds.includes(b.businessId))continue;if(party?.role==='MANAGER'&&d.businessIds.length!==1)continue;

   const consent=await get(table,{pk,sk:'CONSENT#'+d.version});const current=await get(table,{pk,sk:'CURRENT'});
   if(pendingOnly&&(!['FUNDING','DELIVERY'].includes(d.kind)||d.publishedVersion||consent?.hash===d.hash||Date.parse(d.values.effectiveTo)<=(ctx.now?Date.parse(ctx.now()):Date.now())))continue;
   const active=d.kind==='AGREEMENT'&&current?await get(P,{pk,sk:'VERSION#'+current.version}):null;
   const disclosure=d.kind==='AGREEMENT'&&current?await get(P,{pk,sk:'DISCLOSURE#'+current.version}):null;
   const supportReference=d.kind==='AGREEMENT'?await require('./commercial-reference').reference(ctx,d,baseGuards):null;
   const campaign=d.kind==='FUNDING'?await get(d.values.source==='MERCHANT'?'WhizzMerchants_Discounts':'WizzCentral_Platform_Discounts',{discountId:d.values.campaignId}):null;
   if(pendingOnly&&d.kind==='FUNDING'&&(!campaign||campaign.version!==d.values.campaignVersion||campaign.isDeleted||campaign.deletedAt))continue;
   items.push({campaignLabel:campaign?.title||campaign?.name||campaign?.code||null,supportReference,draft:view(d),ownerAccepted:!!consent&&consent.hash===d.hash,current:current?{version:current.version,terms:active?.terms||null,...(d.kind==='DELIVERY'?{policy:current.policy,termsHash:current.termsHash}:{}),disclosure:disclosure?{values:disclosure.values,businessIds:disclosure.businessIds,fundingPolicies:disclosure.fundingPolicies}:null,status:current.status}:null});
  }
  await write(baseGuards);
  return {items,can:{deliveryEnabled:ctx.deliveryFundingEnabled===true,deliveryRequest:ctx.deliveryFundingEnabled===true&&!owner&&allowed(actor,'commercial.funding.request'),direct:direct(),request:!owner&&allowed(actor,'commercial.request'),approve:!owner&&allowed(actor,'commercial.approve'),fundingRequest:!owner&&allowed(actor,'commercial.funding.request'),fundingApprove:!owner&&allowed(actor,'commercial.funding.approve'),accept:owner},businessId:b.businessId,merchantId:b.organizationId};
 }
 if(method!=='POST')fail('METHOD_NOT_ALLOWED',405);
 const action=input.action;
 if(!['SAVE_AGREEMENT','APPROVE_AGREEMENT','ACCEPT_AGREEMENT','SAVE_FUNDING','APPROVE_FUNDING','ACCEPT_FUNDING','SAVE_DELIVERY','ACCEPT_DELIVERY'].includes(action))fail('INVALID_COMMERCIAL_ACTION');
 if(owner!== action.startsWith('ACCEPT_'))fail('PERMISSION_REQUIRED',403);
 const kind=action.endsWith('_DELIVERY')?'DELIVERY':action.includes('FUNDING')?'FUNDING':'AGREEMENT',saving=action.startsWith('SAVE_'),approving=action.startsWith('APPROVE_');
 if(kind==='DELIVERY'&&ctx.deliveryFundingEnabled!==true)fail('DELIVERY_FUNDING_MANAGEMENT_DISABLED',503);
 if(!owner){const permission=kind!=='AGREEMENT'?'commercial.funding.'+(saving?'request':'approve'):'commercial.'+(saving?'request':'approve');if(!allowed(actor,permission)&&!(kind!=='DELIVERY'&&direct()&&approving&&allowed(actor,permission.replace(/approve$/,'request'))))fail('PERMISSION_REQUIRED',403);if(!ctx.enrolled)fail('ENROLLMENT_REQUIRED',403);ctx.recent(ctx.claims);}
 exact(input,['businessId','action','id','requestId','draftVersion','baseVersion',...(saving?['businessIds','values']:['hash']),...(owner?[]:['reason'])]);
 if(typeof input.requestId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input.requestId))fail('REQUEST_ID_REQUIRED');
 version(input.draftVersion);version(input.baseVersion);id(input.id);
 if(!owner&&(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300))fail('REASON_REQUIRED');
 const table=kind==='AGREEMENT'?P:S,pk=(kind==='AGREEMENT'?'COMMERCIAL_AGREEMENT#':kind==='DELIVERY'?'DELIVERY_FUNDING#':'DISCOUNT_FUNDING#')+input.id,key={pk,sk:'DRAFT'},markerKey={pk:'BRANCH#'+b.businessId,sk:'COMMERCIAL_REQUEST#'+input.requestId};
 const principalId=owner?party.role+'#'+principal.sub:'STAFF#'+actor.employeeId,fingerprint=hash({principalId,input});
 const oldRequest=await get(P,markerKey);if(oldRequest){if(oldRequest.fingerprint!==fingerprint||oldRequest.ownerId!==b.ownerId)fail('REQUEST_ID_CONFLICT',409);await write(baseGuards);return {...oldRequest.result,replayed:true};}
 const draft=await get(table,key),current=await get(table,{pk,sk:'CURRENT'});
 if(draft&&(draft.ownerId!==b.ownerId||draft.organizationId!==b.organizationId||!draft.businessIds.includes(b.businessId)))fail('COMMERCIAL_SCOPE_MISMATCH',403);
 if(party?.role==='MANAGER'&&draft&&draft.businessIds.length!==1)fail('COMMERCIAL_SCOPE_MISMATCH',403);
 if(owner&&['FUNDING','DELIVERY'].includes(kind)){const consent=await get(S,{pk,sk:'CONSENT#'+input.draftVersion});if(consent&&consent.hash===input.hash&&draft?.hash===input.hash){await write(baseGuards);return {accepted:true,alreadyAccepted:true,id:input.id,draftVersion:input.draftVersion,publishedVersion:draft.publishedVersion||null};}}
 if((draft?.version||0)!==input.draftVersion||(current?.version||0)!==input.baseVersion)fail('VERSION_OR_STATE_CONFLICT',409);
 const now=ctx.now?ctx.now():new Date().toISOString();let tx=[],result;
 if(saving){
  if(!Array.isArray(input.businessIds)||input.businessIds.length<1||input.businessIds.length>10||new Set(input.businessIds).size!==input.businessIds.length||!input.businessIds.includes(b.businessId))fail('INVALID_COMMERCIAL_SCOPE');
  const ids=[...input.businessIds].sort();ids.forEach(id);
  if(draft&&kind==='FUNDING'&&(draft.values.campaignId!==input.values.campaignId||draft.values.source!==input.values.source))fail('NEW_SHARING_REQUIRED',409);
  if(draft&&JSON.stringify(ids)!==JSON.stringify(draft.businessIds))fail('NEW_AGREEMENT_SCOPE_REQUIRED',409);
  const values=kind==='AGREEMENT'?agreementValues(input.values):kind==='DELIVERY'?readDeliveryFundingPolicy(input.values).policy:fundingValues(input.values);
  if(kind==='DELIVERY'&&(values.id!==input.id||values.version!==input.baseVersion+1||values.branchId!==b.businessId||values.merchantId!==b.organizationId))fail('DELIVERY_POLICY_SCOPE_OR_VERSION_MISMATCH',409);
  if((kind!=='AGREEMENT'||values.scope==='BRANCH')&&ids.length!==1)fail('SINGLE_BRANCH_REQUIRED');
  for(const otherId of ids.filter(x=>x!==b.businessId)){const branch=await get(B,{businessId:otherId});if(!branch||branch.ownerId!==b.ownerId||branch.cognitoUserId!==b.ownerId||branch.organizationId!==b.organizationId||branch.deletionRequestId!=null||branch.deletedAt!=null||branch.isDeleted===true)fail('COMMERCIAL_SCOPE_MISMATCH',403);tx.push(check(B,{businessId:otherId},branch,branchFields),...leaseFences(b.ownerId,[otherId]).slice(1));}
  if(kind==='FUNDING'){const c=await campaignFor(values);tx.push(check(c.table,{discountId:values.campaignId},c.campaign));}
  const fundingPolicies=kind==='AGREEMENT'?await policies(values,ids,b.organizationId):[];
  for(const policy of fundingPolicies)tx.push(check(S,{pk:policy.pk,sk:policy.sk},policy));
  const next={...key,id:input.id,kind,version:input.draftVersion+1,baseVersion:input.baseVersion,ownerId:b.ownerId,organizationId:b.organizationId,businessIds:ids,requestedBy:actor.employeeId,values,fundingPolicies,hash:hash({values,fundingPolicies,businessIds:ids,ownerId:b.ownerId,organizationId:b.organizationId}),createdAt:now,reason:input.reason.trim(),...(kind==='DELIVERY'?{authorizedStaffVersion:actor.version}:direct()?{directPublicationAuthorized:true,authorizedStaffVersion:actor.version}:{})};
  if(['FUNDING','DELIVERY'].includes(kind))tx.push({Put:{TableName:S,Item:require('./commercial-notices').notice(next),ConditionExpression:'attribute_not_exists(pk)'}});
  tx.push({ConditionCheck:{TableName:table,Key:{pk,sk:'CURRENT'},...(current?{ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}:{ConditionExpression:'attribute_not_exists(pk)'})}},{Put:{TableName:table,Item:next,...condition(draft)}},{Put:{TableName:table,Item:{...next,sk:'DRAFT_VERSION#'+next.version},ConditionExpression:'attribute_not_exists(pk)'}});
  for(const businessId of ids){
   const indexKey={pk:'BRANCH#'+businessId,sk:'COMMERCIAL#'+kind+'#'+input.id},oldIndex=await get(P,indexKey);
   const ref=oldIndex?.supportReference;
   tx.push({Put:{TableName:P,Item:{...indexKey,recordPk:pk,kind,ownerId:b.ownerId,businessId,...(ref?{supportReference:ref}:{})},ConditionExpression:'(attribute_not_exists(ownerId) OR ownerId=:o) AND '+(ref?'#ref=:ref':'attribute_not_exists(#ref)'),ExpressionAttributeNames:{'#ref':'supportReference'},ExpressionAttributeValues:{':o':b.ownerId,...(ref?{':ref':ref}:{})}}});
  }
  result={saved:true,id:input.id,draftVersion:next.version,hash:next.hash};
 }else{
  if(!draft||draft.hash!==input.hash||draft.baseVersion!==input.baseVersion||draft.publishedVersion)fail('VERSION_OR_STATE_CONFLICT',409);
  if(owner){
   if(kind==='DELIVERY'){const p=readDeliveryFundingPolicy(draft.values).policy;if(p.effectiveTo<=now)fail('COMMERCIAL_PERIOD_EXPIRED',409);}
   if(kind==='FUNDING'){const c=await campaignFor(fundingValues(draft.values));if(draft.values.effectiveTo<=now)fail('COMMERCIAL_PERIOD_EXPIRED',409);tx.push(check(c.table,{discountId:draft.values.campaignId},c.campaign));}
   for(const policy of await verifyPolicies(draft))tx.push(check(S,{pk:policy.pk,sk:policy.sk},policy));
   for(const businessId of draft.businessIds.filter(x=>x!==b.businessId)){const branch=await get(B,{businessId});if(!branch||branch.ownerId!==b.ownerId||branch.cognitoUserId!==b.ownerId||branch.organizationId!==b.organizationId||branch.deletionRequestId!=null||branch.deletedAt!=null||branch.isDeleted===true)fail('COMMERCIAL_SCOPE_MISMATCH',403);tx.push(check(B,{businessId},branch,branchFields),...leaseFences(b.ownerId,[businessId]).slice(1));}
   const consent={pk,sk:'CONSENT#'+draft.version,...(party.role==='MANAGER'?{acceptedRole:'MANAGER',ownerId:b.ownerId}:{}),subjectId:principal.sub,hash:draft.hash,acceptedAt:now,businessIds:draft.businessIds};
   if(kind==='DELIVERY'){
    const resolved=readDeliveryFundingPolicy(draft.values),values=resolved.policy,nextVersion=input.baseVersion+1;
    if(values.id!==input.id||values.version!==nextVersion||values.branchId!==b.businessId||values.merchantId!==b.organizationId)fail('DELIVERY_POLICY_SCOPE_OR_VERSION_MISMATCH',409);
    const authorKey={pk:'EMPLOYEE#'+draft.requestedBy,sk:'PROFILE'},author=await get(S,authorKey);
    if(!author||author.employeeId!==draft.requestedBy||author.status!=='ACTIVE'||author.version!==draft.authorizedStaffVersion||!allowed(author,'commercial.funding.request')||author.scope?.allRegions!==true)fail('REQUESTER_PERMISSION_REVOKED',403);
    const revision=b.deliveryOfferRevision??0;if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)fail('DELIVERY_POLICY_REVISION_INVALID',409);
    const branchGuard=baseGuards.findIndex(x=>x.ConditionCheck?.TableName===B);if(branchGuard<0)fail('DELIVERY_POLICY_SCOPE_OR_VERSION_MISMATCH',409);const branchFence=baseGuards.splice(branchGuard,1)[0].ConditionCheck;
    tx.push({Update:{...branchFence,UpdateExpression:'SET deliveryOfferRevision=:nextDeliveryRevision',ExpressionAttributeValues:{...branchFence.ExpressionAttributeValues,':nextDeliveryRevision':revision+1}}});
    const policy={pk,sk:'CURRENT',schemaVersion:1,id:input.id,version:nextVersion,status:'ACTIVE',policy:values,termsHash:resolved.termsHash,acceptedBy:principal.sub,acceptedAt:now,approvedBy:author.employeeId,approvedAt:draft.createdAt,activatedAt:now,activationMode:'STAFF_SEND_MERCHANT_ACCEPT'};
    // Consent, activation, history, audit and request replay marker commit together.
    tx.push(deliveryCampaignBudgetInitialization(values),check(S,authorKey,author),
     {Put:{TableName:table,Item:consent,ConditionExpression:'attribute_not_exists(pk)'}},
     {Put:{TableName:S,Item:policy,...(current?{ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}:{ConditionExpression:'attribute_not_exists(pk)'})}},
     {Put:{TableName:S,Item:{...policy,sk:'VERSION#'+nextVersion},ConditionExpression:'attribute_not_exists(pk)'}},
     {Put:{TableName:table,Item:{...draft,version:draft.version+1,publishedVersion:nextVersion},...condition(draft)}});
    result={accepted:true,id:input.id,draftVersion:draft.version,publishedVersion:nextVersion};
   }else{
    tx.push(check(table,key,draft),{Put:{TableName:table,Item:consent,ConditionExpression:'attribute_not_exists(pk)'}});result={accepted:true,id:input.id,draftVersion:draft.version};
   }
  }else if(approving){
   if((kind==='DELIVERY'||!direct())&&draft.requestedBy===actor.employeeId)fail('SELF_APPROVAL_FORBIDDEN',403);
   const requester=await ctx.employee(draft.requestedBy),permission=kind!=='AGREEMENT'?'commercial.funding.request':'commercial.request';if(!requester||!allowed(requester,permission)||requester.scope?.allRegions!==true)fail('REQUESTER_PERMISSION_REVOKED',403);if(requester.employeeId!==actor.employeeId)tx.push(ctx.guard(requester));
   const values=kind==='AGREEMENT'?agreementValues(draft.values):kind==='DELIVERY'?readDeliveryFundingPolicy(draft.values).policy:fundingValues(draft.values);if(values.effectiveTo!==null&&values.effectiveTo<=now)fail('COMMERCIAL_PERIOD_EXPIRED',409);
   const nextVersion=input.baseVersion+1;
   if(kind==='AGREEMENT'){
    const consent=await get(P,{pk,sk:'CONSENT#'+draft.version});if(!consent||consent.subjectId!==b.ownerId||consent.hash!==draft.hash)fail('OWNER_ACCEPTANCE_REQUIRED',409);tx.push(check(P,{pk,sk:consent.sk},consent));
    const terms={id:input.id,version:nextVersion,status:'ACTIVE',merchantId:b.organizationId,branchId:values.scope==='BRANCH'?b.businessId:null,effectiveFrom:values.effectiveFrom,effectiveTo:values.effectiveTo,acceptedAt:consent.acceptedAt,approvedAt:now,commission:values.commission,serviceFee:values.serviceFee};
    const payload={terms,otherCharges:{merchant:parseIqd('0'),platform:parseIqd('0'),thirdParty:parseIqd('0')},allowedFundingPolicyIds:values.allowedFundingPolicyIds,fundingPolicySnapshots:(draft.fundingPolicies||[]).map(p=>({id:p.id,version:p.version,digest:hash(p)}))},termsHash=hash(payload);
    for(const policy of await verifyPolicies(draft))tx.push(check(S,{pk:policy.pk,sk:policy.sk},policy));
    tx.push({Put:{TableName:P,Item:{pk,sk:'DISCLOSURE#'+nextVersion,termsHash,values,businessIds:draft.businessIds,fundingPolicies:draft.fundingPolicies||[]},ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:P,Item:{pk,sk:'VERSION#'+nextVersion,schemaVersion:2,...payload,termsHash},ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:P,Item:{pk,sk:'CURRENT',version:nextVersion,termsHash,status:'ACTIVE'},...(current?{ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}:{ConditionExpression:'attribute_not_exists(pk)'})}},{Put:{TableName:P,Item:{pk,sk:'ACCEPTANCE#'+nextVersion,subjectId:b.ownerId,termsHash,acceptedAt:consent.acceptedAt,status:'ACCEPTED'},ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:S,Item:{pk,sk:'APPROVAL#'+nextVersion,staffId:actor.employeeId,termsHash,approvedAt:now,status:'APPROVED'},ConditionExpression:'attribute_not_exists(pk)'}});
    // Update ownership/reference guards live in each branch Update, never twice on one item.
    const pos=baseGuards.findIndex(x=>x.ConditionCheck?.TableName===B);baseGuards.splice(pos,1);
    for(const businessId of draft.businessIds){const branch=businessId===b.businessId?b:await get(B,{businessId});if(!branch||branch.ownerId!==b.ownerId||branch.cognitoUserId!==b.ownerId||branch.organizationId!==b.organizationId||branch.deletionRequestId!=null||branch.deletedAt!=null||branch.isDeleted===true)fail('COMMERCIAL_SCOPE_MISMATCH',403);
     if(businessId!==b.businessId)tx.push(...leaseFences(b.ownerId,[businessId]).slice(1));
     const fenced=pin(B,{businessId},branch,branchFields);tx.push({Update:{...fenced,UpdateExpression:'SET commercialAgreementId=:aid, commercialAgreementVersion=:av, commercialUpdatedAt=:at',ExpressionAttributeValues:{...fenced.ExpressionAttributeValues,':aid':input.id,':av':nextVersion,':at':now}}});}
   }else{
    const {table:campaignTable,campaign}=await campaignFor(values);
    const consent=await get(S,{pk,sk:'CONSENT#'+draft.version});if(!consent||consent.hash!==draft.hash)fail('OWNER_ACCEPTANCE_REQUIRED',409);
    const signer=await require('./commercial-party').resolve(ctx.db,b,consent.subjectId);if(signer.role==='MANAGER'&&(consent.acceptedRole!=='MANAGER'||consent.ownerId!==b.ownerId))fail('OWNER_ACCEPTANCE_REQUIRED',409);tx.push(...signer.guards);
    tx.push(check(S,{pk,sk:consent.sk},consent),check(campaignTable,{discountId:values.campaignId},campaign));
    const policy={pk,sk:'CURRENT',schemaVersion:3,id:input.id,version:nextVersion,status:'ACTIVE',campaignId:values.campaignId,campaignVersion:values.campaignVersion,source:values.source,merchantId:b.organizationId,branchId:b.businessId,target:'GOODS',effectiveFrom:values.effectiveFrom,effectiveTo:values.effectiveTo,merchantNumerator:values.merchantNumerator,denominator:values.denominator,rounding:'MERCHANT_TOWARD_ZERO_PLATFORM_REMAINDER',merchantShareFinalRounding:values.merchantShareFinalRounding,acceptedBy:consent.subjectId,acceptedAt:consent.acceptedAt,approvedBy:actor.employeeId,approvedAt:now};
    const bindingKey={pk:'BRANCH#'+b.businessId,sk:'COMMERCIAL_SHARING#'+values.source+'#'+values.campaignId},binding=await get(P,bindingKey);
    if(binding&&binding.policyId!==input.id)fail('SHARING_POLICY_EXISTS',409);
    tx.push({Put:{TableName:P,Item:{...bindingKey,ownerId:b.ownerId,businessId:b.businessId,policyId:input.id,policyVersion:nextVersion,policyDigest:hash(policy)},...(binding?{ConditionExpression:'policyId=:id AND policyVersion=:v AND policyDigest=:digest',ExpressionAttributeValues:{':id':binding.policyId,':v':binding.policyVersion,':digest':binding.policyDigest}}:{ConditionExpression:'attribute_not_exists(pk)'})}});
    tx.push({Put:{TableName:S,Item:policy,...(current?{ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':current.version}}:{ConditionExpression:'attribute_not_exists(pk)'})}},{Put:{TableName:S,Item:{...policy,sk:'VERSION#'+nextVersion},ConditionExpression:'attribute_not_exists(pk)'}});
   }
   tx.push({Put:{TableName:table,Item:{...draft,version:draft.version+1,publishedVersion:nextVersion},...condition(draft)}});result={approved:true,id:input.id,version:nextVersion};
  }
 }
 const audit=ctx.audit(principalId,'COMMERCIAL_'+action,{businessId:b.businessId,id:input.id,draftVersion:input.draftVersion},{...result,actorKind:party?.role||principal.kind,writeMode:direct()?'DIRECT':'REVIEW',reason:input.reason||null},input.requestId);
 tx.push({Put:{TableName:P,Item:{...markerKey,ownerId:b.ownerId,businessId:b.businessId,kind,auditKey:{pk:audit.Put.Item.pk,sk:audit.Put.Item.sk},fingerprint,result,createdAt:now},ConditionExpression:'attribute_not_exists(pk)'}},audit);
 await write([...baseGuards,...tx]);return result;
}
async function service(ctx,principal,method,input){
 let result;for(let attempt=0;;attempt++){try{result=await serviceCore(ctx,principal,method,input);break;}catch(e){if(principal.kind!=='OWNER'||input?.action!=='ACCEPT_FUNDING'||e.message!=='VERSION_OR_STATE_CONFLICT'||attempt>=3)throw e;await new Promise(resolve=>setTimeout(resolve,50*(attempt+1)));}}
 if(direct()&&principal.kind==='OWNER'&&method==='POST'&&['ACCEPT_AGREEMENT','ACCEPT_FUNDING'].includes(input.action)){
  const funding=input.action==='ACCEPT_FUNDING',recordTable=funding?S:P,recordPrefix=funding?'DISCOUNT_FUNDING#':'COMMERCIAL_AGREEMENT#';
  const draft=(await ctx.db.send(new GetCommand({TableName:recordTable,Key:{pk:recordPrefix+input.id,sk:'DRAFT'},ConsistentRead:true}))).Item;
  if(draft?.publishedVersion)return {...result,publishedVersion:draft.publishedVersion};
  if(!draft?.directPublicationAuthorized)return result;
  const author=(await ctx.db.send(new GetCommand({TableName:S,Key:{pk:'EMPLOYEE#'+draft.requestedBy,sk:'PROFILE'},ConsistentRead:true}))).Item;
  if(!author||author.version!==draft.authorizedStaffVersion||!allowed(author,funding?'commercial.funding.request':'commercial.request')||author.scope?.allRegions!==true)fail('REQUESTER_PERMISSION_REVOKED',403);
  const digest=hash({requestId:input.requestId,operation:funding?'DIRECT_SHARING_PUBLICATION':'DIRECT_AGREEMENT_PUBLICATION'}),requestId=digest.slice(0,8)+'-'+digest.slice(8,12)+'-4'+digest.slice(13,16)+'-a'+digest.slice(17,20)+'-'+digest.slice(20,32);
  const employee=async id=>(await ctx.db.send(new GetCommand({TableName:S,Key:{pk:'EMPLOYEE#'+id,sk:'PROFILE'},ConsistentRead:true}))).Item;
  const guard=person=>({ConditionCheck:{TableName:S,Key:{pk:'EMPLOYEE#'+person.employeeId,sk:'PROFILE'},ConditionExpression:'#v=:v AND #s=:active',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':person.version,':active':'ACTIVE'}}});
  // Publish the authenticated writer's recorded intent after actual owner consent.
  let published;try{published=await serviceCore({...ctx,employee,guard,enrolled:true,recent:()=>{}},{kind:'STAFF',actor:author},'POST',{businessId:input.businessId,action:funding?'APPROVE_FUNDING':'APPROVE_AGREEMENT',id:input.id,requestId,draftVersion:input.draftVersion,baseVersion:input.baseVersion,hash:input.hash,reason:'DIRECT_AUTHORIZATION_ON_OWNER_ACCEPTANCE'});}catch(e){if(!funding||e.message!=='VERSION_OR_STATE_CONFLICT')throw e;const latest=(await ctx.db.send(new GetCommand({TableName:recordTable,Key:{pk:recordPrefix+input.id,sk:'DRAFT'},ConsistentRead:true}))).Item;const consent=(await ctx.db.send(new GetCommand({TableName:recordTable,Key:{pk:recordPrefix+input.id,sk:'CONSENT#'+input.draftVersion},ConsistentRead:true}))).Item;if(!latest?.publishedVersion||consent?.hash!==input.hash)throw e;published={version:latest.publishedVersion};}
  return {...result,publishedVersion:published.version};
 }
 return result;
}
module.exports={service,agreementValues,fundingValues,hash,pin};
