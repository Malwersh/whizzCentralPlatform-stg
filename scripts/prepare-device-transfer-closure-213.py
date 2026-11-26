"""Fresh additive staging changeset from current source; never execute release75."""
import sys,pathlib,json,zipfile,hashlib,time
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];out=pathlib.Path('/private/tmp/finance-device-closure-213');out.mkdir(exist_ok=True)
s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180'
c=s.client('cloudformation');a=s.client('apigateway')
stack='staging-merchant-device-transfers';assert c.describe_stacks(StackName=stack)['Stacks'][0]['StackStatus']=='REVIEW_IN_PROGRESS'
resources=a.get_resources(restApiId='z14s5f8oxh',limit=500)['items'];assert not any('/branch-device/transfers' in r.get('path','') for r in resources)
(out/'api-before.private.json').write_text(json.dumps(resources));(out/'stage-before.private.json').write_text(json.dumps(a.get_stage(restApiId='z14s5f8oxh',stageName='staging'),default=str))
package=out/'device-transfers.zip'
with zipfile.ZipFile(package,'w',zipfile.ZIP_DEFLATED) as z:z.write(root/'backend/wallet-service/build/device-transfers/index.js','index.js')
raw=package.read_bytes();sha=hashlib.sha256(raw).hexdigest();bucket='aws-sam-cli-managed-default-samclisourcebucket-c0s0eilxsprc';key='merchant-device-transfers/closure213/'+sha+'.zip'
s.client('s3').put_object(Bucket=bucket,Key=key,Body=raw)
template=json.loads((root/'backend/wallet-service/template.device-transfers.json').read_text());template['Resources']['MerchantDeviceFinanceFunction']['Properties']['CodeUri']='s3://'+bucket+'/'+key
(out/'template.json').write_text(json.dumps(template,indent=2))
name='employee-transfers-closure213-'+str(int(time.time()))
r=c.create_change_set(StackName=stack,ChangeSetName=name,ChangeSetType='CREATE',TemplateBody=json.dumps(template),Capabilities=['CAPABILITY_NAMED_IAM','CAPABILITY_AUTO_EXPAND'],Description='Current-source closure of previously local employee transfer; no human grants, balance mutations or OTP requests')
receipt={'changeSetId':r['Id'],'changeSetName':name,'stack':stack,'packageSha256':sha,'templateSha256':hashlib.sha256(json.dumps(template,sort_keys=True).encode()).hexdigest(),'status':'PREPARING','executed':False,'financialOperationsRequested':False}
path=root/'docs/device-transfer-closure-213.json'
path.write_text(json.dumps(receipt,indent=2)+'\n')
for _ in range(150):
 q=c.describe_change_set(StackName=stack,ChangeSetName=r['Id'])
 if q['Status']!='CREATE_IN_PROGRESS':break
 time.sleep(2)
if q['Status']=='CREATE_IN_PROGRESS':
 receipt['status']='AWS_PROCESSING';path.write_text(json.dumps(receipt,indent=2)+'\n');print('AWS still processing; resume the recorded changeset, do not create another');sys.exit(0)
assert q['Status']=='CREATE_COMPLETE',q.get('StatusReason')
changes=[v['ResourceChange'] for v in q['Changes']]
assert len(changes)==33 and all(v['Action']=='Add' for v in changes),[(v['LogicalResourceId'],v['Action']) for v in changes]
receipt.update(status='PREPARED_ADDITIVE_REVIEWED',resources=[{'id':v['LogicalResourceId'],'type':v['ResourceType'],'action':v['Action']} for v in changes])
path.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'status':receipt['status'],'resourceAdditions':len(changes),'packageSha256':sha,'executed':False}))
