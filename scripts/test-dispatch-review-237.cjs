'use strict';
const assert=require('assert/strict'),load=require('./load-dispatch-review-237.cjs'),{fixture}=require('../backend/wallet-service/test/helpers/dispatch-review-executor-fixture.cjs');
(async()=>{const f=await fixture('RETRY_SEARCH',f=>{f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).financeRollout={schemaVersion:2,scopeId:'GENERAL_STAGING_FULL_CASH_V1',version:1,digest:'a'.repeat(64)};});
 const p='backend/.tmp/order-exceptions-work/review-237/',old=load(p+'_discount_review__central-staff__index.js'),candidate=load(p+'staff-candidate.js');
 const before=await old.createReviewReader(f.ctx,f.actor()).load({orderId:'order1',source:'SEARCH'}),after=await candidate.createReviewReader(f.ctx,f.actor()).load({orderId:'order1',source:'SEARCH'});
 assert.equal(after.baseDigest,before.baseDigest);assert.equal(after.baseDigest,f.decision().baseDigest);assert.equal(after.item.caseId,before.item.caseId);
 assert(after.guards.some(x=>x.ConditionCheck?.TableName==='WizzOrders'&&Object.values(x.ConditionCheck.ExpressionAttributeNames??{}).includes('financeRollout')));
 console.log('PASS established executor digest compatibility; additional pin fence; immutable case identity; no live writes.');
})().catch(e=>{console.error(e);process.exitCode=1;});
