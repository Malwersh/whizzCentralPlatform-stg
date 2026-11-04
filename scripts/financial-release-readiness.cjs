'use strict';
// Evaluate live metadata only. This never supplies defaults, authorizes activation or writes configuration.
const integer=(v,min,max)=>typeof v==='string'&&/^[1-9][0-9]*$/.test(v)&&Number.isSafeInteger(Number(v))&&Number(v)>=min&&Number(v)<=max;
const secret=v=>typeof v==='string'&&/^arn:aws:secretsmanager:us-east-1:699561669180:secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}$/.test(v);
function evaluate(input){
 const blockers=[],checks=[];const check=(id,ok)=>{checks.push({id,passed:!!ok});if(!ok)blockers.push(id);};
 const quote=input.quote||{},driver=input.driver||{},writer=input.writer||{},routingHost=input.routingHost||{};
 check('QUOTE_ROUTING_SECRET_CONFIGURED',secret(quote.MAPBOX_SECRET_ARN));
 check('WAVE_ROUTING_SECRET_CONFIGURED',secret(routingHost.FINANCIAL_ROUTING_SECRET_ARN));
 const centralRequested=[quote,driver,routingHost].some(e=>e.DELIVERY_OPERATIONS_MODE==='CENTRAL');
 let central;
 if(centralRequested){
  try{const snapshot=require('../backend/staff-service/dispatch-settings-contract').validateOperationsSnapshot(input.centralOperations);if(snapshot.version<1)throw Error();central=snapshot;}catch{}
  check('CENTRAL_OPERATIONS_CONSISTENT',!!central&&[quote,driver,routingHost].every(e=>e.DELIVERY_OPERATIONS_MODE==='CENTRAL'));
 }
 const configured=(field,legacy,min,max)=>centralRequested?!!central&&Number.isSafeInteger(central.values[field])&&central.values[field]>=min&&central.values[field]<=max:integer(legacy,min,max);
 check('QUOTE_CUSTOMER_QUOTA_CONFIGURED',configured('quoteMaxPerCustomerPerMinute',quote.DELIVERY_QUOTE_MAX_PER_MINUTE,1,120));
 check('DRIVER_OFFER_TTL_CONFIGURED',configured('driverOfferTtlSeconds',driver.FINANCIAL_OFFER_TTL_SECONDS,1,900));
 check('DRIVER_POSITION_MAX_AGE_CONFIGURED',configured('driverPositionMaxAgeSeconds',driver.FINANCIAL_POSITION_MAX_AGE_SECONDS,1,900));
 check('REASSIGNMENT_WINDOW_CONFIGURED',configured('reassignmentWindowSeconds',driver.FINANCIAL_REASSIGNMENT_WINDOW_SECONDS,30,900));
 check('QUOTE_CLEANUP_ENABLED',input.cleanup?.DELIVERY_QUOTES_ENABLED==='true');
 check('PUBLISHED_PRICING_POLICY_VALID',input.pricingValid===true);
 check('COMMERCIAL_WRITER_IAM_READY',Array.isArray(input.writerIam)&&input.writerIam.length>0&&input.writerIam.every(x=>x.decision==='allowed'));
 // These are evidence requirements, never inferred from an ARN, role, zero commission or a successful closed-gate probe.
 const plan=input.discountPlan,none=plan?.mode==='NONE'&&Object.keys(plan).sort().join(',')==='campaignIds,merchantShareMinor,mode,platformShareMinor'&&Array.isArray(plan.campaignIds)&&plan.campaignIds.length===0&&plan.platformShareMinor===0&&plan.merchantShareMinor===0;
 if(plan?.mode==='NONE')check('NO_DISCOUNT_PLAN_VALID',none);
 const notApplicableEvidence=[];
 for(const id of ['ACCEPTED_APPROVED_AGREEMENT','APPROVED_DISCOUNT_FUNDING','PREASSIGNMENT_REJECTION_ATOMIC_RELEASE','PUBLISHED_ROLES_END_TO_END_CANARY','OPERATING_LIMITS_APPROVED','ROLLBACK_VERIFIED','FINAL_PRICE_WALLET_PRECISION_VERIFIED']){
  if(id==='APPROVED_DISCOUNT_FUNDING'&&none){notApplicableEvidence.push(id);checks.push({id,passed:true,state:'NOT_APPLICABLE_NO_DISCOUNT'});}else check(id,input.evidence?.[id]===true);
 }
 const gatesClosed=quote.DELIVERY_QUOTES_ENABLED!=='true'&&['DELIVERY_QUOTE_MODE','COMMERCIAL_PRICING_MODE'].every(k=>(writer[k]??'OFF')==='OFF')&&Object.entries(driver).filter(([k])=>/^FINANCIAL_.*_MODE$/.test(k)).every(([,v])=>v==='OFF')&&Object.entries(routingHost).filter(([k])=>/^FINANCIAL_.*_MODE$/.test(k)).every(([,v])=>v==='OFF');
 return {scope:'METADATA_READINESS_ONLY',gatesClosed,configurationChecks:checks,blockers,notApplicableEvidence,operationsSource:centralRequested?'CENTRAL':'LEGACY_ENV',activationAuthorized:false};
}
module.exports={evaluate};
if(require.main===module){let s='';process.stdin.on('data',v=>s+=v);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(evaluate(JSON.parse(s)))));}
