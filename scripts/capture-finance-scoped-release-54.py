"""Capture Staging packages/config and role policies read-only into a NEW private directory."""
import boto3, json, pathlib, hashlib, base64, urllib.request, concurrent.futures, datetime, os, argparse
p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory');args=p.parse_args()
root=pathlib.Path(args.directory)
if not root.is_absolute() or root.exists(): raise ValueError('NEW_ABSOLUTE_PRIVATE_DIRECTORY_REQUIRED')
root.mkdir(mode=0o700)
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1')
assert s.client('sts').get_caller_identity()['Account']=='699561669180'
lam=s.client('lambda')
names=['WizzUser-DeliveryQuotes-staging','WizzUser-CreateOrder-staging','WaveSystem_CreateDispatchJob','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','WaveSystem_HandleDriverAccept','WaveSystem_HandleDriverReject','DriversApi-staging','staging-driver-financial-accept','staging-cod-integration','staging-wizz-staff-service','staging-wizz-wallet-notification-worker','wizzcentral-notifications-staging-pushSendWaveOffer','WizzUser-CancelOrder-staging','WizzUser-GetGuestOrders-staging','WizzUser-GetOrder-staging','WizzUser-GetUserOrders-staging','WizzUser-MerchantOrderStatusUpdate-staging','WizzUser-SearchOrderByNumber-staging','WizzUser-UpdateOrderStatus-staging','order-receiver-merchant-orders-staging-v1']
def capture(name):
 f=lam.get_function(FunctionName=name); c=f['Configuration']; assert c['FunctionArn']==f'arn:aws:lambda:us-east-1:699561669180:function:{name}'
 data=urllib.request.urlopen(f['Code']['Location'],timeout=60).read(); assert base64.b64encode(hashlib.sha256(data).digest()).decode()==c['CodeSha256']
 (root/(name+'.zip')).write_bytes(data); (root/(name+'.config.json')).write_text(json.dumps(c))
 return {'name':name,'handler':c['Handler'],'runtime':c['Runtime'],'codeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'role':c['Role'],'environmentDigest':hashlib.sha256(json.dumps(c.get('Environment',{}).get('Variables',{}),sort_keys=True).encode()).hexdigest()}
try:
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as p: rows=list(p.map(capture,names))
 iam=s.client('iam'); policies={}
 for role in sorted(set(r['role'] for r in rows)):
  n=role.rsplit('/',1)[-1]; inline={x:iam.get_role_policy(RoleName=n,PolicyName=x)['PolicyDocument'] for page in iam.get_paginator('list_role_policies').paginate(RoleName=n) for x in page['PolicyNames']}; attached={}
  for page in iam.get_paginator('list_attached_role_policies').paginate(RoleName=n):
   for a in page['AttachedPolicies']:
    v=iam.get_policy(PolicyArn=a['PolicyArn'])['Policy']['DefaultVersionId']; attached[a['PolicyArn']]=iam.get_policy_version(PolicyArn=a['PolicyArn'],VersionId=v)['PolicyVersion']['Document']
  policies[role]={'role':iam.get_role(RoleName=n)['Role'],'inline':inline,'attached':attached}
 (root/'roles.json').write_text(json.dumps(policies,default=str))
 (root/'inventory.json').write_text(json.dumps({'account':'699561669180','region':'us-east-1','capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'functions':rows},indent=2))
 for f in root.iterdir():
  if f.is_file():f.chmod(0o600)
 print(json.dumps({'capturedFunctions':len(rows),'roles':len(policies),'awsMutations':0}))
except Exception as e:
 print(type(e).__name__); raise SystemExit(1)
