"""Read-only current Staging code/config/IAM inventory. Never invokes app handlers."""
import pathlib,json,subprocess,hashlib,base64,urllib.request,os,datetime
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path('/private/tmp/finance113')
HOSTS={'staff':'staging-wizz-staff-service','merchant':'order-receiver-regional-staging-unified-auth-v4-sam','worker':'staging-account-deletion-worker','expiry':'staging-account-deletion-financial-expiry'}
def private(path,data):
 path.write_bytes(data if isinstance(data,bytes) else json.dumps(data,indent=2,default=str).encode());path.chmod(0o600)
def main():
 import boto3
 OUT.mkdir(mode=0o700,exist_ok=True)
 if (OUT/'inventory.json').exists():raise RuntimeError('CAPTURE_ALREADY_EXISTS')
 creds=json.loads(subprocess.check_output(['aws','configure','export-credentials','--profile','Wizz_stg_UserApp','--format','process'],stderr=subprocess.DEVNULL))
 session=boto3.Session(aws_access_key_id=creds['AccessKeyId'],aws_secret_access_key=creds['SecretAccessKey'],aws_session_token=creds['SessionToken'],region_name='us-east-1')
 assert session.client('sts').get_caller_identity()['Account']=='699561669180'
 lam=session.client('lambda');iam=session.client('iam');inventory={}
 for label,name in HOSTS.items():
  result=lam.get_function(FunctionName=name);cfg=result['Configuration'];code=urllib.request.urlopen(result['Code']['Location'],timeout=60).read()
  assert base64.b64encode(hashlib.sha256(code).digest()).decode()==cfg['CodeSha256'];assert cfg['Runtime'] in ['nodejs18.x','nodejs20.x','nodejs22.x','nodejs24.x'];assert label!='staff' or cfg['Runtime']=='nodejs22.x'
  private(OUT/(label+'.zip'),code);private(OUT/(label+'.config.private.json'),cfg)
  role=cfg['Role'].rsplit('/',1)[1];policies={};roleinfo=iam.get_role(RoleName=role)['Role'];private(OUT/(label+'.role.private.json'),roleinfo)
  for page in iam.get_paginator('list_role_policies').paginate(RoleName=role):
   for policyname in page['PolicyNames']:policies['inline:'+policyname]=iam.get_role_policy(RoleName=role,PolicyName=policyname)['PolicyDocument']
  for page in iam.get_paginator('list_attached_role_policies').paginate(RoleName=role):
   for item in page['AttachedPolicies']:
    policy=iam.get_policy(PolicyArn=item['PolicyArn'])['Policy'];policies['managed:'+item['PolicyArn']]=iam.get_policy_version(PolicyArn=item['PolicyArn'],VersionId=policy['DefaultVersionId'])['PolicyVersion']['Document']
  private(OUT/(label+'.policies.private.json'),policies)
  env=cfg.get('Environment',{}).get('Variables',{})
  inventory[label]={'name':name,'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'role':cfg['Role'],'handler':cfg['Handler'],'runtime':cfg['Runtime'],'codeSize':cfg['CodeSize'],'environmentBytes':len(json.dumps(env,separators=(',',':')).encode()),'scheduleGateEnabled':env.get('SETTLEMENT_SCHEDULE_ADMIN_ENABLED')=='true','inlineOrManagedPolicies':len(policies)}
 private(OUT/'inventory.json',{'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'hosts':inventory,'mutations':0})
 print(json.dumps({'capturedHosts':list(inventory),'scheduleGates':{k:v['scheduleGateEnabled'] for k,v in inventory.items()},'awsMutations':0}))
if __name__=='__main__':main()
