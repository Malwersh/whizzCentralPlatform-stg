const {test}=require('node:test'), assert=require('node:assert/strict');
const {deflateSync}=require('node:zlib');
const {createHandler}=require('../../backend/src/handlers/support-attachments-handler');
const files=require('../../backend/src/utils/support-attachments');
const {createHash}=require('node:crypto');
function png(width=1,height=1) {
  const chunk=(type,body)=>{
    const data=Buffer.concat([Buffer.from(type),body]); let crc=0xffffffff;
    for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;}
    const length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(body.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);
    return Buffer.concat([length,data,sum]);
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);
}
const bytes=png(), id='11111111-1111-4111-8111-111111111111';
const env={SUPPORT_ATTACHMENTS_TABLE:'files',SUPPORT_ATTACHMENTS_BUCKET:'private-fixture',SUPPORT_BUCKET_OWNER:'123456789012',CHAT_SESSIONS_TABLE:'sessions',CHAT_MESSAGES_TABLE:'messages',SUPPORT_ALLOWED_ORIGIN:'https://portal.invalid'};
function fixture({owner='owner-1',membership=true,failUpload=false,closed=false,userType='merchant',onUpload,conflictPut=false,allowedOrigins=env.SUPPORT_ALLOWED_ORIGIN}={}){
  const rows=new Map([['sessions:s1',{sessionId:'s1',userId:owner,businessId:'branch-1',userType,status:closed?'closed':'active'}]]), writes=[], objects=new Map(),calls=[];
  const key=i=>i.TableName+':'+(i.Key?.attachmentId||i.Key?.messageKey||i.Key?.sessionId||i.Item?.attachmentId);
  const db={async send(cmd){const i=cmd.input,n=cmd.constructor.name;
    if(n==='GetCommand') return {Item:rows.get(key(i))};
    if(n==='PutCommand'){if(conflictPut)throw Object.assign(new Error('conflict'),{name:'ConditionalCheckFailedException'});writes.push(cmd);rows.set(key(i),structuredClone(i.Item));return {};}
    if(n==='UpdateCommand'){writes.push(cmd);rows.get(key(i)).status='UPLOADED';return {};}
    throw Error(n);
  }};
  const s3={async send(cmd){calls.push(cmd);const i=cmd.input;
    if(cmd.constructor.name==='PutObjectCommand'){if(failUpload)throw Error('upload failed');objects.set(i.Key,Buffer.from(i.Body));if(onUpload)await onUpload(rows);return {};}
    const data=objects.get(i.Key);return {ContentLength:data.length,Body:{async transformToByteArray(){return data;}}};
  }};
  const handler=createHandler({db,s3,env:{...env,SUPPORT_ALLOWED_ORIGIN:allowedOrigins},verify:async(token,role)=>{if(token!=='fixture'||role!==userType)throw Error('invalid');return {sub:'owner-1',exp:Math.floor(Date.now()/1000)+3600};},authorizeMerchant:async()=>membership});
  const invoke=(method='POST',input={},headers={})=>handler({httpMethod:method,headers:{Authorization:'Bearer fixture','X-Support-User-Type':userType,...headers},
    ...(method==='GET'?{queryStringParameters:input}:{body:JSON.stringify({sessionId:'s1',uploadId:id,contentType:'image/png',dataBase64:bytes.toString('base64'),...input})})});
  return {invoke,rows,writes,objects,calls};
}
test('PNG container, CRC, dimensions and declared MIME are validated',()=>{
  assert.equal(files.validateImage(bytes,'image/png').size,bytes.length);
  assert.throws(()=>files.validateImage(Buffer.from('<svg/>'),'image/png'));
  assert.throws(()=>files.validateImage(bytes,'image/jpeg'));
  const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;
  assert.throws(()=>files.validateImage(corrupt,'image/png'));
  assert.throws(()=>files.validateImage(png(8193,1),'image/png'));
  assert.throws(()=>files.validateImage(Buffer.alloc(files.MAX_BYTES+1),'image/png'));
});
test('valid upload is private, encrypted, checksum-bound and returns a reference, never a URL',async()=>{
  const h=fixture(),res=await h.invoke();assert.equal(res.statusCode,200);
  assert.equal(JSON.parse(res.body).attachmentId,id);assert.equal(JSON.parse(res.body).imageUrl,undefined);
  const stored=h.rows.get('files:'+id);assert.equal(stored.status,'UPLOADED');assert.equal(stored.subjectId,'owner-1');
  const upload=h.calls[0].input;assert.equal(upload.ServerSideEncryption,'AES256');assert.equal(upload.ExpectedBucketOwner,env.SUPPORT_BUCKET_OWNER);
  assert.equal(upload.ChecksumSHA256,createHash('sha256').update(bytes).digest('base64'));assert.equal(upload.ACL,undefined);
  assert.equal(res.headers['Cache-Control'],'no-store');
});
test('idempotent upload retries do not create a second S3 write',async()=>{
  const h=fixture();await h.invoke();assert.equal((await h.invoke()).statusCode,200);assert.equal(h.calls.length,1);
});
for(const options of [{owner:'other'},{membership:false},{closed:true}])test('invalid session or branch authorization cannot upload '+JSON.stringify(options),async()=>{
  const h=fixture(options),res=await h.invoke();assert.ok(res.statusCode>=400);assert.equal(h.writes.length,0);assert.equal(h.calls.length,0);
});
test('unauthenticated upload cannot touch storage',async()=>{
  const h=fixture();assert.equal((await h.invoke('POST',{}, {Authorization:'Bearer invalid'})).statusCode,401);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
});
test('invalid image or malformed base64 is rejected before storage',async()=>{
  for(const dataBase64 of ['not base64',Buffer.from('<svg/>').toString('base64')]){
    const h=fixture();assert.equal((await h.invoke('POST',{dataBase64})).statusCode,400);assert.equal(h.calls.length,0);assert.equal(h.writes.length,0);
  }
});
test('failed object upload does not mark the attachment ready',async()=>{
  const h=fixture({failUpload:true});assert.equal((await h.invoke()).statusCode,503);assert.equal(h.rows.get('files:'+id).status,'PENDING');
});
test('unpublished objects cannot be downloaded even by their uploader',async()=>{
  const h=fixture();await h.invoke();const before=h.calls.length;
  assert.equal((await h.invoke('GET',{sessionId:'s1',attachmentId:id})).statusCode,404);assert.equal(h.calls.length,before);
});
test('published object requires a saved message and current membership on every fetch',async()=>{
  const h=fixture();await h.invoke();const row=h.rows.get('files:'+id);row.status='PUBLISHED';row.messageKey='message-1';
  assert.equal((await h.invoke('GET',{sessionId:'s1',attachmentId:id})).statusCode,404);
  h.rows.set('messages:message-1',{attachment:{attachmentId:id}});
  const res=await h.invoke('GET',{sessionId:'s1',attachmentId:id});assert.equal(res.statusCode,200);assert.equal(JSON.parse(res.body).dataBase64,bytes.toString('base64'));
  h.rows.get('sessions:s1').userId='other';const before=h.calls.length;
  assert.equal((await h.invoke('GET',{sessionId:'s1',attachmentId:id})).statusCode,403);assert.equal(h.calls.length,before);
});
test('cross-origin requests are restricted to the explicitly configured portal',async()=>{
  const h=fixture();assert.equal((await h.invoke('POST',{}, {Origin:'https://hostile.invalid'})).statusCode,403);assert.equal(h.calls.length,0);
  const res=await h.invoke('POST',{}, {Origin:'https://portal.invalid'});assert.equal(res.statusCode,200);assert.equal(res.headers['Access-Control-Allow-Origin'],'https://portal.invalid');
});

test('truncated JPEG scan headers fail as invalid images, not runtime errors', () => {
  for (const hex of ['ffd8ffffffffffffd9', 'ffd8ffda0001ffd9', 'ffd8ffda0008ffd9']) {
    assert.throws(() => files.validateImage(Buffer.from(hex, 'hex'), 'image/jpeg'), error => error.code === 'IMAGE_INVALID' && error.status === 400);
  }
});

test('customer image upload and download retain verified session ownership',async()=>{
 const h=fixture({userType:'customer'});
 assert.equal((await h.invoke()).statusCode,200);
 const row=h.rows.get('files:'+id); assert.equal(row.userType,'customer');
 row.status='PUBLISHED'; row.messageKey='customer-message';
 h.rows.set('messages:customer-message',{attachment:{attachmentId:id}});
 assert.equal((await h.invoke('GET',{sessionId:'s1',attachmentId:id})).statusCode,200);
 h.rows.get('sessions:s1').userId='other'; const before=h.calls.length;
 assert.equal((await h.invoke('GET',{sessionId:'s1',attachmentId:id})).statusCode,403); assert.equal(h.calls.length,before);
});

test('session closed during object upload never becomes ready',async()=>{
 const h=fixture({onUpload:rows=>{rows.get('sessions:s1').status='closed';}});
 const res=await h.invoke(); assert.equal(res.statusCode,409);
 assert.equal(h.rows.get('files:'+id).status,'PENDING');
 assert.equal(h.writes.filter(c=>c.constructor.name==='UpdateCommand').length,0);
});
test('ownership revoked during upload cannot publish a ready attachment',async()=>{
 const h=fixture({onUpload:rows=>{rows.get('sessions:s1').userId='other';}});
 assert.equal((await h.invoke()).statusCode,403);
 assert.equal(h.rows.get('files:'+id).status,'PENDING');
});
test('competing upload reservation returns a conflict without an object write',async()=>{
 const h=fixture({conflictPut:true}),res=await h.invoke();
 assert.equal(res.statusCode,409); assert.equal(JSON.parse(res.body).error,'UPLOAD_STATE_CONFLICT');
 assert.equal(h.calls.length,0);
});
test('reused upload ID cannot change content, owner, role or session',async()=>{
 for(const change of [{checksum:'different'},{subjectId:'other'},{userType:'driver'},{sessionId:'other'}]){
  const h=fixture();await h.invoke();Object.assign(h.rows.get('files:'+id),change);
  assert.equal((await h.invoke()).statusCode,409);assert.equal(h.calls.length,1);
 }
});
test('expired or malformed attachment expiry denies retries and downloads',async()=>{
 for(const ttl of [undefined,null,'9999999999',NaN,0]){
  const h=fixture();await h.invoke();const row=h.rows.get('files:'+id);
  Object.assign(row,{ttl,status:'PUBLISHED',messageKey:'saved'});
  h.rows.set('messages:saved',{attachment:{attachmentId:id}});
  assert.equal((await h.invoke()).statusCode,409);
  assert.equal((await h.invoke('GET',{sessionId:'s1',attachmentId:id})).statusCode,404);
  assert.equal(h.calls.length,1);
 }
});

test('explicit origin list permits both hosting domains and rejects lookalikes',async()=>{
 const h=fixture({allowedOrigins:'https://portal.invalid, https://staging.example.invalid'});
 for(const origin of ['https://portal.invalid','https://staging.example.invalid']){
  const res=await h.invoke('OPTIONS',{}, {Origin:origin});assert.equal(res.statusCode,204);assert.equal(res.headers['Access-Control-Allow-Origin'],origin);
 }
 for(const origin of ['https://portal.invalid.hostile.invalid','https://staging.example.invalid.hostile.invalid']){
  const res=await h.invoke('OPTIONS',{}, {Origin:origin});assert.equal(res.statusCode,403);assert.equal(res.headers['Access-Control-Allow-Origin'],undefined);
 }
});
