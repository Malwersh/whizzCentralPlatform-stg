from pathlib import Path
import json,subprocess,zipfile,io,copy,hashlib,base64,time
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/driver-payout-audit-360';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
assert aws('sts','get-caller-identity')['Account']=='699561669180';assert 'pass 53' in Path('/tmp/payout360-tests.log').read_text();assert not Path('/tmp/payout360-tsc.log').read_text().strip();assert 'PASS actual runtime authority hooks' in Path('/tmp/payout360-wiring.log').read_text()
c=json.loads((P/'config.private.json').read_text());live=aws('lambda','get-function-configuration','--function-name',c['FunctionName']);assert live['RevisionId']==c['RevisionId'] and live['CodeSha256']==c['CodeSha256'];raw=(P/'before.zip').read_bytes();assert sha(raw)==c['CodeSha256'];z=zipfile.ZipFile(io.BytesIO(raw));changes={'driver-cash-payout-runtime-v1.js':(P/'runtime-after.js').read_bytes(),'driver-payout-audit-360.js':(P/'driver-payout-audit-360.js').read_bytes()};assert z.read('driver-cash-payout-runtime-v1.js')==(P/'runtime-before.js').read_bytes();candidate=P/'candidate.zip'
with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 for f,data in changes.items():
  if f not in z.namelist():out.writestr(f,data)
with zipfile.ZipFile(candidate) as out:assert all(out.read(f)==z.read(f) for f in z.namelist() if f not in changes)
dest=R/'docs/driver-payout-audit-publication-360.json';r={'part':360,'scope':'staging','function':c['FunctionName'],'status':'PUBLISHING','beforeSha256':c['CodeSha256'],'candidateSha256':sha(candidate.read_bytes()),'changedFiles':list(changes),'allOtherEntriesPreserved':True,'iamChanges':False,'financialRecordsWritten':0,'historicalAuditRowsModified':0};dest.write_text(json.dumps(r,indent=2)+'\n');aws('lambda','update-function-code','--function-name',c['FunctionName'],'--revision-id',c['RevisionId'],'--zip-file','fileb://'+str(candidate));print('Publishing exact driver cash payout audit delta',flush=True)
for _ in range(90):
 live=aws('lambda','get-function-configuration','--function-name',c['FunctionName'])
 if live['LastUpdateStatus']=='Successful':break
 assert live['LastUpdateStatus']!='Failed';time.sleep(1)
else:raise RuntimeError('Update pending')
assert live['CodeSha256']==r['candidateSha256'];assert all(live.get(k)==c.get(k) for k in ['Role','Environment','Runtime','Handler','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig']);r.update(status='PUBLISHED_STAGING_SHA_VERIFIED_HUMAN_ACCEPTANCE_PENDING',configurationPreserved=True,testsPassed=53,bundleAuthorityAndSdkBridge='PASS');dest.write_text(json.dumps(r,indent=2)+'\n');print('PASS driver cash payout audit published; original finance configuration and unrelated code preserved')
