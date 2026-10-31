from pathlib import Path
import json,zipfile,io,copy,hashlib,base64,subprocess,time,difflib
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/financial-audit-359';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
assert aws('sts','get-caller-identity')['Account']=='699561669180';assert 'pass 74' in Path('/tmp/audit359-unit.log').read_text();assert not Path('/tmp/audit359-tsc.log').read_text().strip()
c=json.loads((P/'config.private.json').read_text());assert c['Environment']['Variables']['STAFF_TABLE']=='staging-PlatformStaff';assert c['Environment']['Variables']['WALLET_CREATION_CALLER_ROLE_ARN'];live=aws('lambda','get-function-configuration','--function-name',c['FunctionName']);assert live['RevisionId']==c['RevisionId'] and live['CodeSha256']==c['CodeSha256'];raw=(P/'before.zip').read_bytes();assert sha(raw)==c['CodeSha256'];z=zipfile.ZipFile(io.BytesIO(raw));changes={}
for m,count in [('topupService',6),('walletLimitsSettings',2)]:
 old=z.read('dist/'+m+'.js').decode();new=(R/'backend/wallet-service/dist'/(m+'.js')).read_text();delta=list(difflib.unified_diff(old.splitlines(True),new.splitlines(True)));assert sum(l.startswith('@@') for l in delta)==count,'UNREVIEWED_DIFF '+m
for m in ['topupService','walletLimitsSettings','financialAudit']:
 for ext in ['.js','.js.map']:changes['dist/'+m+ext]=(R/'backend/wallet-service/dist'/(m+ext)).read_bytes()
candidate=P/'candidate.zip'
with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 for f,data in changes.items():
  if f not in z.namelist():out.writestr(f,data)
with zipfile.ZipFile(candidate) as out:assert all(out.read(f)==z.read(f) for f in z.namelist() if f not in changes)
# Preserve audit/table permissions, exact IAM provisioning identity binding, financial modes, provider setup, and all other modules.
dest=R/'docs/financial-audit-publication-359.json';r={'part':359,'scope':'staging','status':'PUBLISHING','function':c['FunctionName'],'beforeSha256':c['CodeSha256'],'candidateSha256':sha(candidate.read_bytes()),'changedFiles':list(changes),'allOtherEntriesPreserved':True,'financialRecordsWritten':0,'historicalAuditRowsModified':0,'iamChanges':False};dest.write_text(json.dumps(r,indent=2)+'\n')
aws('lambda','update-function-code','--function-name',c['FunctionName'],'--revision-id',c['RevisionId'],'--zip-file','fileb://'+str(candidate));print('Publishing financial audit module delta',flush=True)
for _ in range(90):
 live=aws('lambda','get-function-configuration','--function-name',c['FunctionName'])
 if live['LastUpdateStatus']=='Successful':break
 assert live['LastUpdateStatus']!='Failed';time.sleep(1)
else:raise RuntimeError('Update pending')
assert live['CodeSha256']==r['candidateSha256'];assert all(live.get(k)==c.get(k) for k in ['Environment','Role','Handler','Runtime','MemorySize','Timeout','Layers','VpcConfig','Architectures']);r.update(status='PUBLISHED_STAGING_SHA_VERIFIED_HUMAN_ACCEPTANCE_PENDING',configurationPreserved=True,testsPassed=74);dest.write_text(json.dumps(r,indent=2)+'\n');print('PASS financial audit publication; amounts, configuration and unrelated modules unchanged')
