const test=require('node:test'),assert=require('node:assert/strict');
const {isUsable,getAttachment}=require('../../support-evidence-546/support-attachments');
const {keyFor}=require('../complaint-image-retention');
const caseId='OEX:'+'a'.repeat(48);
function image(){
 const r={attachmentId:'11111111-1111-4111-8111-111111111111',subjectId:'customer',userType:'customer',status:'PUBLISHED',
   sessionId:'session',messageKey:'message',checksum:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',contentType:'image/png',size:10,retentionHold:true,
   evidenceRetention:{kind:'CUSTOMER_POST_DELIVERY_EVIDENCE',caseId,orderId:'order',customerId:'customer',sessionId:'session',checksum:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',retainedAt:'2026-11-11T00:00:00Z'}};
 r.key=keyFor(r,caseId);return r;
}
test('temporary images expire while properly bound complaint evidence remains available',()=>{
 assert.equal(isUsable({ttl:100},99),true);assert.equal(isUsable({ttl:100},100),false);
 assert.equal(isUsable(image(),9999999999),true);
});
test('retention flag alone, missing owner or mismatched case metadata cannot bypass expiry',()=>{
 const r=image();assert.equal(isUsable({...r,subjectId:undefined}),false);
 assert.equal(isUsable({...r,evidenceRetention:{...r.evidenceRetention,sessionId:'other'}}),false);
 assert.equal(isUsable({retentionHold:true}),false);assert.equal(isUsable({...r,ttl:1}),false);
});
test('attachment lookup keeps validation and reads only requested metadata',async()=>{
 const row=image(),calls=[],db={send:async c=>{calls.push(c.input);return {Item:row};}};
 assert.equal((await getAttachment(db,'support-attachments-staging',row.attachmentId)).attachmentId,row.attachmentId);
 assert.equal(calls[0].ConsistentRead,true);assert.deepEqual(calls[0].Key,{attachmentId:row.attachmentId});
 await assert.rejects(getAttachment(db,'support-attachments-staging','invalid'),/ATTACHMENT_INVALID/);assert.equal(calls.length,1);
});
