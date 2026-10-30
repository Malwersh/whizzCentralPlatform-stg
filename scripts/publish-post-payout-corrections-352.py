"""Publish only the prepared staging overlays; never modifies balances or paid sources."""
from pathlib import Path
import json,subprocess,hashlib,base64,time,uuid,datetime
R=Path(__file__).resolve().parents[1];O=R/'backend/.tmp/post-payout-352';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw) if raw.strip() else {}
assert aws('sts','get-caller-identity')['Account']=='699561669180'
m=json.loads((O/'manifest.private.json').read_text());assert {v['name'] for v in m}=={'staging-wizz-staff-service','staging-account-deletion-worker','order-receiver-regional-staging-unified-auth-v4-sam'}
proof=json.loads((O/'retention-condition-proof.json').read_text());assert proof=={'current':'implicitDeny','withNarrowConditionPolicy':'allowed'}
for group in json.loads((O/'iam-simulation.json').read_text()):assert all(x['EvalDecision']=='allowed' for x in group['actions'])
assert json.loads((O/'preflight.json').read_text())['status']=='PASS'
fields=['Runtime','Handler','Role','Environment','MemorySize','Timeout','Layers','VpcConfig','Architectures','TracingConfig','EphemeralStorage','DeadLetterConfig','FileSystemConfigs']
for v in m:
 c=aws('lambda','get-function-configuration','--function-name',v['name']);old=json.loads((O/v['name']/'config.private.json').read_text());assert c['CodeSha256']==v['beforeSha256'] and c['RevisionId']==v['revisionId'],'LIVE_DRIFT '+v['name'];assert all(c.get(k)==old.get(k) for k in fields)
 assert base64.b64encode(hashlib.sha256(Path(v['candidate']).read_bytes()).digest()).decode()==v['candidateSha256']
record={'part':352,'scope':'staging','status':'PUBLISHING','functions':[],'financialRecordsWritten':0,'balanceChanges':False,'paidSourceChanges':False,'iamChange':'ConditionCheckItem only on MERCHANT_CORRECTIONS#* during retention','lambdaConfigurationChanges':False};dest=R/'docs/post-payout-correction-publication-352.json'
def save():dest.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
save()
# Add a create-only, narrowly scoped archive fence policy. Existing policies remain untouched.
worker=next(v for v in m if v['name']=='staging-account-deletion-worker');role=worker['role'].split('/')[-1];name='PostPayoutCorrectionRetention352';policy=json.loads((O/'retention-condition-policy.json').read_text());policy['Statement'][0]['Condition']['Null']={'dynamodb:LeadingKeys':'false'}
existing=json.loads(subprocess.check_output(B+['iam','list-role-policies','--role-name',role,'--output','json']))['PolicyNames']
if name in existing:assert aws('iam','get-role-policy','--role-name',role,'--policy-name',name)['PolicyDocument']==policy
else:aws('iam','put-role-policy','--role-name',role,'--policy-name',name,'--policy-document',json.dumps(policy))
record['retentionConditionPolicyCreatedOrVerified']=True;save()
# Persist the user-approved default as configuration, not a financial posting.
key={'pk':{'S':'OPERATIONAL_SETTINGS#MERCHANT_CORRECTIONS'},'sk':{'S':'CURRENT'}};old=aws('dynamodb','get-item','--table-name','staging-MerchantPlatform','--key',json.dumps(key),'--consistent-read').get('Item')
if old:
 assert old.get('kind',{}).get('S')=='MERCHANT_CORRECTION_POLICY' and old.get('recoveryMode',{}).get('S')=='OFFSET_NEXT_SETTLEMENT' and old.get('applyCredits',{}).get('BOOL') is True,'POLICY_ALREADY_CHANGED'
else:
 now=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z');rid=str(uuid.uuid4());item={**key,'kind':{'S':'MERCHANT_CORRECTION_POLICY'},'version':{'N':'1'},'recoveryMode':{'S':'OFFSET_NEXT_SETTLEMENT'},'applyCredits':{'BOOL':True},'updatedAt':{'S':now},'updatedBy':{'S':'SYSTEM:RELEASE352'},'reason':{'S':'اعتماد خصم مديونية المطعم من التسويات القادمة وترحيل المتبقي بتوجيه المستخدم'}}
 audit={'datePartition':{'S':'date#'+now[:10].replace('-','')},'sk':{'S':'RELEASE352#'+rid},'logId':{'S':rid},'kind':{'S':'CONFIGURATION_AUDIT'},'actorId':{'S':'SYSTEM:RELEASE352'},'action':{'S':'MERCHANT_CORRECTION_POLICY_INITIALIZED'},'createdAt':{'S':now},'recoveryMode':{'S':'OFFSET_NEXT_SETTLEMENT'},'reason':{'S':'User approved future-settlement offset; no balances or paid sources changed'}}
 tx=[{'Put':{'TableName':'staging-MerchantPlatform','Item':item,'ConditionExpression':'attribute_not_exists(pk)'}},{'Put':{'TableName':'staging-AuditLog','Item':audit,'ConditionExpression':'attribute_not_exists(sk)'}}];aws('dynamodb','transact-write-items','--transact-items',json.dumps(tx));record['configurationRecordsInitialized']=1;record['configurationAuditWritten']=True;save()
record['effectiveRecoveryMode']='OFFSET_NEXT_SETTLEMENT';save()
# Retention understands new evidence before any application can create it.
for name in ['staging-account-deletion-worker','staging-wizz-staff-service','order-receiver-regional-staging-unified-auth-v4-sam']:
 v=next(v for v in m if v['name']==name);aws('lambda','update-function-code','--function-name',name,'--revision-id',v['revisionId'],'--zip-file','fileb://'+v['candidate']);
 for i in range(60):
  c=aws('lambda','get-function-configuration','--function-name',name)
  if c.get('LastUpdateStatus')=='Successful':break
  assert c.get('LastUpdateStatus')!='Failed',name;time.sleep(1)
 else:raise RuntimeError('Deployment pending '+name)
 old=json.loads((O/name/'config.private.json').read_text());assert c['CodeSha256']==v['candidateSha256'] and all(c.get(k)==old.get(k) for k in fields),'POST_PUBLICATION_DRIFT'
 record['functions'].append({'name':name,'codeSha256':c['CodeSha256'],'changedFiles':v['changedFiles'],'configurationPreserved':True,'unrelatedEntriesPreserved':True});save();print('Published and SHA verified',name,flush=True)
# Unauthenticated smoke only; do not invoke retention jobs or any real financial workflow.
payload={'action':'settlement_schedule_owner','accessToken':'invalid-smoke-token','httpMethod':'GET','input':{'view':'settlement-corrections','branchId':'invalid'}};target=O/'unauthorized-smoke.json';meta=aws('lambda','invoke','--function-name','staging-wizz-staff-service','--cli-binary-format','raw-in-base64-out','--payload',json.dumps(payload),str(target));result=json.loads(target.read_text());assert not meta.get('FunctionError') and result.get('statusCode') in [401,403]
record['unauthenticatedSmokeStatus']=result['statusCode'];record['status']='BACKEND_PUBLISHED_VERIFIED_HUMAN_ACCEPTANCE_OPEN';save();print('PASS: backend publication verified; no balance or paid-source rows changed.',flush=True)
