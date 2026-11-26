'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDriverDocumentCleanup } = require('./driver-documents.cjs');
const { tables } = require('./evidence.cjs');

const subjectId = '12345678-0000-4000-8000-000000000071';
const requestId = '12345678-0000-4000-8000-000000000072';
const prefix = 'drivers/' + subjectId + '/';
const bucket = 'wizz-production-driver-documents-746727375268-us-east-1';

function fixture({ hold = false, foreign = false, upload = false, lost = false, partial = false } = {}) {
  const calls = [];
  const writes = [];
  const request = {
    actorType:'DRIVER',status:'PROCESSING',subjectId,requestId,scope:{kind:'ACCOUNT',id:subjectId},
    pk:'SUBJECT#DRIVER#'+subjectId,sk:'REQUEST#'+requestId,version:2,leaseOwner:'test-worker',
  };
  const job = { subjectId, requestId, profileIds:[subjectId] };
  const db = { async send({input}) {
    if (input.TransactItems) {
      writes.push(input.TransactItems);
      if (lost) throw Object.assign(Error('lost lease'),{name:'TransactionCanceledException'});
      return {};
    }
    if (input.TableName === tables.driver) {
      return { Item:{driverId:subjectId,cognitoSub:subjectId,deletionRequestId:requestId,retentionHold:hold,
        vehicleRegistry:{items:{car:{registrationUrl:'s3://'+bucket+'/'+prefix+'vehicles/car/file.png'}}}} };
    }
    assert.equal(input.TableName,tables.deletion);
    assert.equal(input.ConsistentRead,true);
    return { Items:upload?[{pk:'ACCOUNT_OPERATION#DRIVER#'+subjectId,subjectId,expiresAt:10}]:[] };
  }};
  let listing = 0;
  const s3 = { async send(command) {
    calls.push(command);
    assert.equal(command.input.Bucket,bucket);
    assert.equal(command.input.ExpectedBucketOwner,'746727375268');
    if (command.constructor.name==='ListObjectVersionsCommand' && !listing++) {
      return { Versions:[{Key:foreign?'drivers/someone-else/file':prefix+'file',VersionId:'v1'}],
        DeleteMarkers:[{Key:prefix+'old',VersionId:'d1'}] };
    }
    if (command.constructor.name==='DeleteObjectsCommand' && partial) return {Errors:[{Code:'AccessDenied'}]};
    return {};
  }};
  const cleanup=createDriverDocumentCleanup({db,s3,clock:()=>1000});
  return { calls,writes,run:()=>cleanup.purge(request,job) };
}

test('production document cleanup removes only the verified driver versions and delete markers',async()=>{
  const { calls,writes,run }=fixture();
  await run();
  const deletion=calls.find(command=>command.constructor.name==='DeleteObjectsCommand');
  assert.deepEqual(deletion.input.Delete.Objects,[{Key:prefix+'file',VersionId:'v1'},{Key:prefix+'old',VersionId:'d1'}]);
  assert.ok(writes.every(tx=>tx[1].ConditionCheck.Key.pk==='ACCOUNT_LIFECYCLE#DRIVER#'+subjectId));
  assert.equal(calls.at(-1).constructor.name,'ListObjectsV2Command');
});

for (const [option,code] of [
  ['hold','DOCUMENTED_RETENTION_HOLD'],['foreign','ASSET_SCOPE_INVALID'],
  ['upload','EXTERNAL_WRITES_IN_PROGRESS'],['lost','TransactionCanceledException'],
]) {
  test(option+' stops deletion of production driver documents',async()=>{
    const { calls,run }=fixture({[option]:true});
    await assert.rejects(run(),option==='lost'?{name:code}:{code});
    assert.ok(!calls.some(command=>command.constructor.name==='DeleteObjectsCommand'));
  });
}

test('a failed object deletion requests a retry',async()=>{
  await assert.rejects(fixture({partial:true}).run(),{code:'ASSET_DELETE_RETRY_REQUIRED'});
});
