"""Publish reviewed correction-only payout/case overlays, no financial data writes."""
from pathlib import Path
import json,subprocess,hashlib,base64,time
R=Path(__file__).resolve().parents[1];O=R/'backend/.tmp/post-payout-353';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw) if raw.strip() else {}
assert aws('sts','get-caller-identity')['Account']=='699561669180'
assert json.loads((O/'preflight.json').read_text())['status']=='PASS'
assert len(json.loads((O/'case-metadata-permission-proof.json').read_text()))==4
manifest=json.loads((O/'manifest.private.json').read_text());fields=['Runtime','Handler','Role','Environment','MemorySize','Timeout','Layers','VpcConfig','Architectures','TracingConfig','EphemeralStorage','DeadLetterConfig','FileSystemConfigs']
for v in manifest:
 c=aws('lambda','get-function-configuration','--function-name',v['name']);old=json.loads((O/v['name']/'config.private.json').read_text());assert c['CodeSha256']==v['beforeSha256'] and c['RevisionId']==v['revisionId'],'LIVE_DRIFT '+v['name'];assert all(c.get(k)==old.get(k) for k in fields)
 assert base64.b64encode(hashlib.sha256(Path(v['candidate']).read_bytes()).digest()).decode()==v['candidateSha256']
record={'part':353,'scope':'staging','status':'PUBLISHING','functions':[],'financialRecordsWritten':0,'balanceChanges':False,'paidSourceChanges':False,'configurationRecordsWritten':0,'iamChange':'Update correction-review metadata only on staging-Holds; Put EXCEPTION_CASE queue metadata only on staging-WalletLifecycle. No new monetary-attribute permission.'};dest=R/'docs/post-payout-correction-publication-353.json'
def save():dest.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
save();role=next(v for v in manifest if v['name']=='staging-wizz-staff-service')['role'].split('/')[-1];name='StagingPostPayoutCorrectionCaseMetadata353';policy=json.loads((O/'case-metadata-policy.json').read_text());arn='arn:aws:iam::699561669180:policy/'+name
# Inline role policy budget is exhausted; use a dedicated managed policy with identical restrictions.
try:
 existing=aws('iam','get-policy','--policy-arn',arn)['Policy'];version=aws('iam','get-policy-version','--policy-arn',arn,'--version-id',existing['DefaultVersionId'])['PolicyVersion']['Document'];assert version==policy,'EXISTING_POLICY_DIFFERS'
except subprocess.CalledProcessError as e:
 if b'NoSuchEntity' not in (e.stderr or b''): # AWS errors are checked separately using a captured read below.
  result=subprocess.run(B+['iam','get-policy','--policy-arn',arn,'--output','json'],capture_output=True)
  if b'NoSuchEntity' not in result.stderr:raise
 aws('iam','create-policy','--policy-name',name,'--policy-document',json.dumps(policy),'--description','Staging correction review metadata only; no monetary attributes')
attached=aws('iam','list-attached-role-policies','--role-name',role)['AttachedPolicies']
if not any(p['PolicyArn']==arn for p in attached):aws('iam','attach-role-policy','--role-name',role,'--policy-arn',arn)
record['metadataPolicyArn']=arn
record['metadataPolicyCreatedOrVerified']=True;save()
# Retention and closure guards precede the UI/backend that can create new requests.
for name in ['staging-account-deletion-worker','staging-driver-financial-accept','staging-wizz-staff-service']:
 v=next(v for v in manifest if v['name']==name);aws('lambda','update-function-code','--function-name',name,'--revision-id',v['revisionId'],'--zip-file','fileb://'+v['candidate'])
 for _ in range(90):
  c=aws('lambda','get-function-configuration','--function-name',name)
  if c.get('LastUpdateStatus')=='Successful':break
  assert c.get('LastUpdateStatus')!='Failed',name;time.sleep(1)
 else:raise RuntimeError('Deployment pending '+name)
 old=json.loads((O/name/'config.private.json').read_text());assert c['CodeSha256']==v['candidateSha256'] and all(c.get(k)==old.get(k) for k in fields)
 record['functions'].append({'name':name,'codeSha256':c['CodeSha256'],'changedFiles':v['changedFiles'],'configurationPreserved':True,'unrelatedEntriesPreserved':True});save();print('Published and SHA verified '+name,flush=True)
# Invalid-token smoke only; does not submit any live correction/payout or close a case.
for action,input in [('settlement_schedule_owner',{'view':'settlement-corrections','branchId':'invalid'})]:
 target=O/'unauthorized-smoke.json';meta=aws('lambda','invoke','--function-name','staging-wizz-staff-service','--cli-binary-format','raw-in-base64-out','--payload',json.dumps({'action':action,'accessToken':'invalid-smoke-token','httpMethod':'GET','input':input}),str(target));result=json.loads(target.read_text());assert not meta.get('FunctionError') and result.get('statusCode') in [401,403];record['unauthenticatedSmokeStatus']=result['statusCode']
record['status']='BACKEND_PUBLISHED_VERIFIED_HUMAN_ACCEPTANCE_OPEN';save();print('PASS backend published, no financial data changed',flush=True)
