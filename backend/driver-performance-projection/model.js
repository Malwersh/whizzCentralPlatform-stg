'use strict';
const {POLICY,validId}=require('./contract');
const {createHash}=require('node:crypto');
function buildProjection(performance,quality,now){
 if(performance?.rulesVersion!=='OBSERVED_DRIVER_PERFORMANCE_V4'||!performance.acceptance||!performance.completion||!performance.readCoverage)throw Error('INVALID_PERFORMANCE_RESULT');
 const p=structuredClone(performance);
 if(!p.rejections||!Number.isSafeInteger(p.rejections.consecutive)||p.rejections.consecutive<0||typeof p.rejections.windowComplete!=='boolean')throw Error('INVALID_REJECTION_STREAK');
 const events=p.details?.acceptance||[];
 const minimum=p.completion.completed+p.completion.returned;
 const exact=p.readCoverage.exhausted===true&&p.readCoverage.legacyExcluded===0&&p.completion.acceptedCommitments<p.windowSize;
 p.experience={verifiedFulfilledMinimum:minimum,totalFulfilled:exact?minimum:null,status:exact?'AVAILABLE':'LOWER_BOUND',basis:'VERIFIED_FINANCIAL_ACCEPTANCE_OUTCOMES'};
 p.quality={status:quality?.coverageComplete?'AVAILABLE':'PARTIAL',observed:quality?.items?.length??0,substantiated:0,notSubstantiated:0,pending:0,appealsOpen:0,affectsEligibility:false,basis:'VERIFIED_QUALITY_CASES'};
 for(const q of quality?.items||[]){if(q.appealOpen){p.quality.appealsOpen++;p.quality.pending++;}else if(q.state==='RESOLVED'&&q.decision==='SUBSTANTIATED')p.quality.substantiated++;else if(q.state==='RESOLVED'&&q.decision==='NOT_SUBSTANTIATED')p.quality.notSubstantiated++;else p.quality.pending++;}
 const details=p.details||{};delete p.details;
 // Thirty-day activity changes without a new source event. Expire precisely at its next boundary.
 const expiries=events.filter(e=>e.status==='ACCEPTED').map(e=>Date.parse(e.occurredAt)+30*86400000+1).filter(t=>t>now);
 const boundary=Date.parse(p.activity?.nextChangeAt);
 const validUntil=new Date(Math.min(now+3600000,...expiries,...(Number.isFinite(boundary)&&boundary>now?[boundary]:[]))).toISOString();
 return {snapshot:p,details,validUntil,policyVersion:POLICY};
}
function offerReference(row){
 if(!validId(row?.driverId)||!validId(row?.orderId)||typeof row?.SK!=='string'||!Number.isFinite(Date.parse(row?.sentAt)))return null;
 const identity=validId(row.offerId)?row.offerId:createHash('sha256').update(row.orderId+'|'+row.SK).digest('hex');
 return {driverId:row.driverId,sk:'OFFER#'+row.sentAt+'#'+identity,source:{orderId:row.orderId,SK:row.SK},indexRow:{driverId:row.driverId,orderId:row.orderId,SK:row.SK,sentAt:row.sentAt}};
}
function ratingReference(row){return row?.pk?.startsWith('ORDER#')&&validId(row.driverId)&&typeof row.driverRatingSort==='string'&&row.driverRatingKey==='DRIVER#'+row.driverId?{driverId:row.driverId,sk:'RATING#'+row.driverRatingSort,source:{pk:row.pk},indexRow:{pk:row.pk,driverRatingKey:row.driverRatingKey,driverRatingSort:row.driverRatingSort}}:null;}
module.exports={buildProjection,offerReference,ratingReference};
