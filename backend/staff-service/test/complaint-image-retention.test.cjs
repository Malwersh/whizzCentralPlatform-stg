'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {retain,isRetained,keyFor}=require('../complaint-image-retention');
const data=Buffer.from('verified-image-bytes'),sha=b=>createHash('sha256').update(b).digest('base64');
const caseId='OEX:'+'a'.repeat(48),at='2026-11-11T12:00:00Z';
function fixture() {
  const image={attachmentId:'11111111-1111-4111-8111-111111111111',subjectId:'customer',userType:'customer',
    sessionId:'session',messageKey:'message',status:'PUBLISHED',checksum:sha(data),size:data.length,contentType:'image/png',
    key:'support-images/'+createHash('sha256').update('session').digest('hex')+'/11111111-1111-4111-8111-111111111111',ttl:Date.parse(at)/1000+60};
  const objects=new Map([[image.key,Buffer.from(data)]]),calls=[];
  const s3={async send(command){const q=command.input;calls.push(command);
    assert.equal(q.ExpectedBucketOwner,'699561669180');
    if(command.constructor.name==='GetObjectCommand'){
      const b=objects.get(q.Key);if(!b)throw Error('NotFound');
      return {ContentType:image.contentType,ContentLength:b.length,Body:{transformToByteArray:async()=>b}};
    }
    assert.equal(command.constructor.name,'PutObjectCommand');assert.equal(q.IfNoneMatch,'*');
    assert.equal(q.ServerSideEncryption,'AES256');assert.equal(q.ChecksumSHA256,sha(q.Body));
    if(objects.has(q.Key))throw Object.assign(Error('exists'),{name:'PreconditionFailed'});
    objects.set(q.Key,Buffer.from(q.Body));return {};
  }};
  const run=extra=>retain({image,caseId,orderId:'order',subjectId:'customer',at,now:Date.parse(at),s3,bucket:'private-bucket',bucketOwner:'699561669180',...extra});
  return {image,objects,calls,run};
}
test('verified private copy has deterministic case key and metadata hold without TTL',async()=>{
 const f=fixture(),r=await f.run();assert.equal(isRetained(r),true);assert.equal(r.ttl,undefined);
 assert.equal(r.key,keyFor(f.image,caseId));assert.equal(f.image.ttl>0,true);
 assert.deepEqual(f.objects.get(r.key),data);assert.equal(r.evidenceRetention.customerId,'customer');
});
test('same image retry verifies existing copy instead of overwriting it',async()=>{
 const f=fixture(),a=await f.run(),b=await f.run();assert.deepEqual(a,b);
 assert.equal(f.calls.filter(c=>c.constructor.name==='GetObjectCommand').length,3);
});
test('changed source bytes cannot become complaint proof',async()=>{
 const f=fixture();f.objects.set(f.image.key,Buffer.from('altered-image-bytes!!'));
 await assert.rejects(f.run(),/RETENTION_UNAVAILABLE/);
 assert.equal(f.calls.filter(c=>c.constructor.name==='PutObjectCommand').length,0);
});
test('conflicting destination bytes never count as successful retention',async()=>{
 const f=fixture();f.objects.set(keyFor(f.image,caseId),Buffer.from('wrong'));
 await assert.rejects(f.run(),/RETENTION_UNAVAILABLE/);
});
test('expired image, other owner and arbitrary source key fail before storage access',async()=>{
 for(const patch of [{ttl:1},{subjectId:'other'},{key:'some-other-private-object'},{retentionHold:true}]){
  const f=fixture();Object.assign(f.image,patch);await assert.rejects(f.run(),/RETENTION_UNAVAILABLE/);assert.equal(f.calls.length,0);
 }
});
test('retained descriptor needs exact binding and cannot bypass expiry with a flag alone',async()=>{
 const f=fixture(),r=await f.run();
 for(const patch of [{key:f.image.key},{ttl:1},{subjectId:'other'},{retentionHold:false}])assert.equal(isRetained({...r,...patch}),false);
 assert.equal(isRetained({...f.image,retentionHold:true}),false);
 await assert.rejects(f.run({image:r,caseId:'OEX:'+'b'.repeat(48)}),/RETENTION_UNAVAILABLE/);
});
test('S3 failure propagates and never fabricates a retained row',async()=>{
 const f=fixture();await assert.rejects(f.run({s3:{send:async()=>{throw Error('AccessDenied');}}}),/AccessDenied/);
});
test('already protected object is reverified without another upload',async()=>{
 const f=fixture(),r=await f.run();f.calls.length=0;assert.equal(isRetained(await f.run({image:r})),true);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].constructor.name,'GetObjectCommand');
});
