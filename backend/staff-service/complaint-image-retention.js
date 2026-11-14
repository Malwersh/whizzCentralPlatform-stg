'use strict';
const {createHash} = require('node:crypto');
const digest = data => createHash('sha256').update(data).digest('hex');
const fail = () => {throw Object.assign(Error('COMPLAINT_IMAGE_RETENTION_UNAVAILABLE'), {code:'COMPLAINT_IMAGE_RETENTION_UNAVAILABLE',status:409});};
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function keyFor(row, caseId) {
  return 'complaint-evidence/' + digest(caseId) + '/' + row.attachmentId + '/' + digest(row.checksum);
}
function isRetained(row) {
  const r = row?.evidenceRetention;
  return !!(r && typeof row.subjectId==='string' && row.subjectId.length>0 && typeof row.sessionId==='string' && row.sessionId.length>0 && typeof row.messageKey==='string' && row.messageKey.length>0 && ['image/jpeg','image/png'].includes(row.contentType) && Number.isSafeInteger(row.size) && row.size>0 && row.size<=2*1024*1024 && r.kind === 'CUSTOMER_POST_DELIVERY_EVIDENCE' && /^OEX:[a-f0-9]{48}$/.test(r.caseId) &&
    typeof r.orderId === 'string' && r.orderId.length > 0 && r.customerId === row.subjectId &&
    r.sessionId === row.sessionId && r.checksum === row.checksum && typeof r.retainedAt === 'string' &&
    Number.isFinite(Date.parse(r.retainedAt)) && row.retentionHold === true && row.ttl === undefined &&
    row.userType === 'customer' && row.status === 'PUBLISHED' && uuid.test(row.attachmentId || '') &&
    /^[A-Za-z0-9+/]{43}=$/.test(row.checksum || '') && row.key === keyFor(row,r.caseId));
}
async function bytes(object, row) {
  if (!object?.Body || object.ContentType !== row.contentType || object.ContentLength !== row.size) fail();
  const data = Buffer.from(await object.Body.transformToByteArray());
  if (data.length !== row.size || createHash('sha256').update(data).digest('base64') !== row.checksum) fail();
  return data;
}
async function retain({image, caseId, orderId, subjectId, at, s3, bucket, bucketOwner, now=Date.now()}) {
  if (!image || !/^OEX:[a-f0-9]{48}$/.test(caseId || '') || typeof orderId !== 'string' || !orderId ||
      !subjectId || typeof image.sessionId!=='string' || !image.sessionId || typeof image.messageKey!=='string' || !image.messageKey || image.subjectId !== subjectId || image.userType !== 'customer' || image.status !== 'PUBLISHED' ||
      !uuid.test(image.attachmentId || '') || !['image/jpeg','image/png'].includes(image.contentType) ||
      !Number.isSafeInteger(image.size) || image.size < 1 || image.size > 2*1024*1024 ||
      !/^[A-Za-z0-9+/]{43}=$/.test(image.checksum || '') || !Number.isFinite(Date.parse(at))) fail();
  if (isRetained(image)) {
    if (image.evidenceRetention.caseId !== caseId || image.evidenceRetention.orderId !== orderId) fail();
  } else if (!Number.isFinite(image.ttl) || image.ttl <= now/1000 ||
      image.key !== 'support-images/' + digest(image.sessionId) + '/' + image.attachmentId || image.evidenceRetention || image.retentionHold) fail();
  bucket = bucket || process.env.COMPLAINT_EVIDENCE_BUCKET;
  bucketOwner = bucketOwner || process.env.COMPLAINT_EVIDENCE_BUCKET_OWNER;
  if (!bucket || !/^\d{12}$/.test(bucketOwner || '')) fail();
  const {S3Client,GetObjectCommand,PutObjectCommand} = require('@aws-sdk/client-s3');
  s3 = s3 || new S3Client({});
  const target = keyFor(image,caseId), common={Bucket:bucket,ExpectedBucketOwner:bucketOwner};
  const data = await bytes(await s3.send(new GetObjectCommand({...common,Key:image.key})),image);
  if (image.key !== target) {
    try {
      await s3.send(new PutObjectCommand({...common,Key:target,Body:data,ContentType:image.contentType,
        ServerSideEncryption:'AES256',ChecksumSHA256:image.checksum,IfNoneMatch:'*'}));
    } catch (e) {
      if (e.name !== 'PreconditionFailed' && e.$metadata?.httpStatusCode !== 412) throw e;
      await bytes(await s3.send(new GetObjectCommand({...common,Key:target})),image);
    }
  }
  const row={...image,key:target,retentionHold:true,evidenceRetention:{kind:'CUSTOMER_POST_DELIVERY_EVIDENCE',
    caseId,orderId,customerId:subjectId,sessionId:image.sessionId,checksum:image.checksum,retainedAt:at}};
  delete row.ttl;
  return row;
}
module.exports={retain,isRetained,keyFor};
