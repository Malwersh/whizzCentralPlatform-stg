"""Publish two read-only report modules and least-attribute read policies."""
from pathlib import Path
import json,subprocess,hashlib,base64,time
R=Path(__file__).resolve().parents[1];O=R/'backend/.tmp/reconciliation-354';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw) if raw.strip() else {}
assert aws('sts','get-caller-identity')['Account']=='699561669180';assert 'fail 0' in Path('/tmp/reconciliation354-tests.log').read_text();assert 'PASS reconciliation UI' in Path('/tmp/reconciliation354-browser.log').read_text();assert Path('/tmp/company354-browser.log').read_text().count('PASS:')==2;assert not Path('/tmp/reconciliation354-tsc.log').read_text().strip()
assert len(json.loads((O/'permission-proof.json').read_text()))==4
manifest=json.loads((O/'manifest.private.json').read_text());fields=['Runtime','Handler','Role','Environment','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig','EphemeralStorage','FileSystemConfigs','DeadLetterConfig']
for m in manifest:
 c=aws('lambda','get-function-configuration','--function-name',m['name']);assert c['CodeSha256']==m['beforeSha256'] and c['RevisionId']==m['revisionId'];assert base64.b64encode(hashlib.sha256(Path(m['candidate']).read_bytes()).digest()).decode()==m['candidateSha256']
r={'part':354,'scope':'staging','status':'PUBLISHING','functions':[],'financialRecordsWritten':0,'balanceChanges':False,'iamChange':'Projected read only for company report and active driver payout proof; no monetary writes'};dest=R/'docs/reconciliation-publication-354.json'
def save():dest.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
save()
for label,name in [('staff','staging-wizz-staff-service'),('wallet','staging-wizz-wallet-service')]:
 role=next(x['role'] for x in manifest if x['name']==name).split('/')[-1];policy=json.loads((O/(label+'-read-policy.json')).read_text());pname='StagingReconciliationRead354-'+label;arn='arn:aws:iam::699561669180:policy/'+pname
 found=subprocess.run(B+['iam','get-policy','--policy-arn',arn,'--output','json'],capture_output=True)
 if found.returncode:
  assert b'NoSuchEntity' in found.stderr;aws('iam','create-policy','--policy-name',pname,'--policy-document',json.dumps(policy),'--description','Projected staging financial reconciliation reads only')
 else:
  version=json.loads(found.stdout)['Policy']['DefaultVersionId'];assert aws('iam','get-policy-version','--policy-arn',arn,'--version-id',version)['PolicyVersion']['Document']==policy
 attached=aws('iam','list-attached-role-policies','--role-name',role)['AttachedPolicies']
 if not any(x['PolicyArn']==arn for x in attached):aws('iam','attach-role-policy','--role-name',role,'--policy-arn',arn)
 r.setdefault('readPolicies',[]).append({'role':role,'policyArn':arn});save()
for m in manifest:
 aws('lambda','update-function-code','--function-name',m['name'],'--revision-id',m['revisionId'],'--zip-file','fileb://'+m['candidate'])
 for _ in range(90):
  c=aws('lambda','get-function-configuration','--function-name',m['name'])
  if c['LastUpdateStatus']=='Successful':break
  assert c['LastUpdateStatus']!='Failed';time.sleep(1)
 else:raise RuntimeError('Deployment pending')
 old=json.loads((O/(m['name']+'-config.private.json')).read_text());assert c['CodeSha256']==m['candidateSha256'] and all(c.get(k)==old.get(k) for k in fields)
 r['functions'].append({'name':m['name'],'codeSha256':c['CodeSha256'],'changedFiles':m['changedFiles'],'configurationPreserved':True,'otherEntriesPreserved':True});save();print('Published SHA verified',m['name'],flush=True)
r['status']='BACKEND_PUBLISHED_VERIFIED_HUMAN_ACCEPTANCE_OPEN';save();print('PASS read-only reconciliation publication')
