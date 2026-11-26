"""Publish versioned wallet operating limits without monetary/configuration mutations."""
from pathlib import Path
import json,subprocess,hashlib,base64,time
R=Path(__file__).resolve().parents[1];O=R/'backend/.tmp/wallet-limits-355';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw) if raw.strip() else {}
assert aws('sts','get-caller-identity')['Account']=='699561669180'
assert 'fail 0' in Path('/tmp/limits355-unit.log').read_text()
assert 'All tests passed!' in Path('/tmp/limits355-flutter.log').read_text()
assert 'PASS limits UI' in Path('/tmp/limits355-browser.log').read_text()
assert not Path('/tmp/limits355-tsc.log').read_text().strip()
manifest=json.loads((O/'manifest.private.json').read_text());fields=['Runtime','Handler','Role','Environment','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig','EphemeralStorage','FileSystemConfigs','DeadLetterConfig']
for m in manifest:
 c=aws('lambda','get-function-configuration','--function-name',m['name']);assert c['CodeSha256']==m['beforeSha256'] and c['RevisionId']==m['revisionId'];assert base64.b64encode(hashlib.sha256(Path(m['candidate']).read_bytes()).digest()).decode()==m['candidateSha256']
r={'part':355,'scope':'staging','status':'PUBLISHING','functions':[],'financialRecordsWritten':0,'balanceChanges':False,'iamChange':'Exact operating limits key read/condition only for driver financial service'};dest=R/'docs/wallet-operating-limits-publication-355.json'
def save():dest.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
save()
role=next(x['role'] for x in manifest if x['name']=='staging-driver-financial-accept').split('/')[-1]
policy={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/staging-IdempotencyKeys','Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['CONFIG#WALLET_OPERATING_LIMITS']},'Null':{'dynamodb:LeadingKeys':'false'}}}]}
arn='arn:aws:iam::699561669180:policy/StagingWalletLimitsRead355'
found=subprocess.run(B+['iam','get-policy','--policy-arn',arn,'--output','json'],capture_output=True)
if found.returncode:
 assert b'NoSuchEntity' in found.stderr
 aws('iam','create-policy','--policy-name','StagingWalletLimitsRead355','--policy-document',json.dumps(policy),'--description','Read only exact staging operating limits record')
else:
 version=json.loads(found.stdout)['Policy']['DefaultVersionId'];assert aws('iam','get-policy-version','--policy-arn',arn,'--version-id',version)['PolicyVersion']['Document']==policy
proof=[]
for key,action,expected in [('CONFIG#WALLET_OPERATING_LIMITS','dynamodb:GetItem','allowed'),('CONFIG#WALLET_OPERATING_LIMITS','dynamodb:ConditionCheckItem','allowed'),('CONFIG#OTHER','dynamodb:GetItem','implicitDeny'),('CONFIG#WALLET_OPERATING_LIMITS','dynamodb:PutItem','implicitDeny')]:
 result=aws('iam','simulate-custom-policy','--policy-input-list',json.dumps(policy),'--action-names',action,'--resource-arns',policy['Statement'][0]['Resource'],'--context-entries',json.dumps([{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyValues':[key],'ContextKeyType':'stringList'}]))['EvaluationResults'][0]['EvalDecision'];assert result==expected;proof.append({'key':key,'action':action,'decision':result})
(O/'permission-proof.json').write_text(json.dumps(proof,indent=2))
if not any(x['PolicyArn']==arn for x in aws('iam','list-attached-role-policies','--role-name',role)['AttachedPolicies']):aws('iam','attach-role-policy','--role-name',role,'--policy-arn',arn)
r['readPolicies']=[{'role':role,'policyArn':arn}];save()
for m in manifest:
 aws('lambda','update-function-code','--function-name',m['name'],'--revision-id',m['revisionId'],'--zip-file','fileb://'+m['candidate'])
 for _ in range(90):
  c=aws('lambda','get-function-configuration','--function-name',m['name'])
  if c['LastUpdateStatus']=='Successful':break
  assert c['LastUpdateStatus']!='Failed';time.sleep(1)
 else:raise RuntimeError('Deployment pending')
 old=json.loads((O/(m['name']+'-config.private.json')).read_text());assert c['CodeSha256']==m['candidateSha256'] and all(c.get(k)==old.get(k) for k in fields)
 r['functions'].append({'name':m['name'],'codeSha256':c['CodeSha256'],'changedFiles':m['changedFiles'],'configurationPreserved':True,'otherEntriesPreserved':True});save();print('Published SHA verified',m['name'],flush=True)
r['status']='BACKEND_PUBLISHED_VERIFIED_HUMAN_ACCEPTANCE_OPEN';save();print('PASS operating limits publication; no balances or business settings changed')
