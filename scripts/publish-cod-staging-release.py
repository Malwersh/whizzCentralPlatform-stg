#!/usr/bin/env python3
"""Controlled Staging publication. No financial activation, existing environment writes, table writes, or worker execution."""
import boto3,json,hashlib,sys,time
from pathlib import Path
from botocore.exceptions import ClientError
root=Path(sys.argv[1]);audit=Path(sys.argv[2]);mode=sys.argv[3];assert mode in ['--create-stack-review','--execute-stack','--publish-code','--switch-merchant-stage']
plan=json.loads((root/'deployment-plan.json').read_text());manifest=json.loads((root/'manifest.json').read_text());assert plan['account']=='699561669180' and plan['region']=='us-east-1' and plan['newFlags']=='OFF' and not plan['newScheduleEnabled']
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']==plan['account'];lam=s.client('lambda');cfn=s.client('cloudformation');api=s.client('apigateway');store=s.client('s3');stack=plan['stack']
assert stack=='staging-cod-lifecycle'
def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True).encode()).hexdigest()
def environment(name):return json.loads((audit/(name+'.configuration.private.json')).read_text()).get('Environment',{}).get('Variables',{})
def check_existing(allow_published=False):
 for f in manifest['functions']:
  if f.get('newFunction'):continue
  live=lam.get_function_configuration(FunctionName=f['name']);same=live['CodeSha256']==f['baseCodeSha256'] and live['RevisionId']==f['baseRevisionId']
  if allow_published and live['CodeSha256']==f['zip']['codeSha256']:same=True
  assert same,'LIVE_REVISION_CHANGED:'+f['name'];assert live['Role']==f['role'],'ROLE_CHANGED';assert digest(live.get('Environment',{}).get('Variables',{}))==digest(environment(f['name'])),'ENVIRONMENT_CHANGED:'+f['name']
  assert not any(k.startswith('FINANCIAL_') and k.endswith('_MODE') and v=='REQUIRED' for k,v in live.get('Environment',{}).get('Variables',{}).items())
if mode=='--create-stack-review':
 check_existing()
 for f in manifest['functions']:
  if f.get('newFunction'):
   try:lam.get_function_configuration(FunctionName=f['name']);raise RuntimeError('NEW_FUNCTION_ALREADY_EXISTS')
   except lam.exceptions.ResourceNotFoundException:pass
 existing=api.get_resources(restApiId='ie7z8r4wc0',limit=500)['items'];assert not any(x['path'] in ['/auth/order-returns','/auth/order-cancellation'] for x in existing)
 for obj in plan['uploads']:
  data=Path(obj['path']).read_bytes();assert hashlib.sha256(data).hexdigest()==obj['sha256']
  try:store.put_object(Bucket=plan['bucket'],Key=obj['key'],Body=data,ServerSideEncryption='AES256',IfNoneMatch='*',ExpectedBucketOwner=plan['account'])
  except ClientError as e:
   if e.response['Error']['Code'] not in ['PreconditionFailed','412']:raise
   assert hashlib.sha256(store.get_object(Bucket=plan['bucket'],Key=obj['key'],ExpectedBucketOwner=plan['account'])['Body'].read()).hexdigest()==obj['sha256']
 obj=next(o for o in plan['uploads'] if o.get('stack')==stack)
 r=cfn.create_change_set(StackName=stack,ChangeSetName='cod26-'+str(int(time.time())),ChangeSetType='CREATE',TemplateURL=f"https://{plan['bucket']}.s3.us-east-1.amazonaws.com/{obj['key']}",Parameters=[{'ParameterKey':k,'ParameterValue':v} for k,v in plan['parameters'].items()],Capabilities=['CAPABILITY_IAM','CAPABILITY_NAMED_IAM'],Tags=[{'Key':'Release','Value':'COD26'},{'Key':'Environment','Value':'staging'}],Description='Disabled COD lifecycle and isolated new child routes; no existing API/stack template update')
 (root/'standalone-changeset.json').write_text(json.dumps({'stack':stack,'id':r['Id'],'templateSha256':obj['sha256']},indent=2)+'\n');print(json.dumps({'stack':stack,'changeSetCreated':True}))
elif mode=='--execute-stack':
 check_existing();ref=json.loads((root/'standalone-changeset.json').read_text());review=cfn.describe_change_set(ChangeSetName=ref['id']);assert review['Status']=='CREATE_COMPLETE'
 allowed={'AWS::Lambda::Function','AWS::IAM::Role','AWS::IAM::Policy','AWS::Events::Rule','AWS::Lambda::Permission','AWS::ApiGateway::Resource','AWS::ApiGateway::Method','AWS::ApiGateway::Deployment'}
 changes=[x['ResourceChange'] for x in review['Changes']];assert all(x['Action']=='Add' and x['ResourceType'] in allowed for x in changes)
 # No RestApi/Stage/table/authorizer replacement or modification is permitted.
 (root/'standalone-review.json').write_text(json.dumps([{'id':v['LogicalResourceId'],'type':v['ResourceType'],'action':v['Action']} for v in changes],indent=2)+'\n')
 cfn.execute_change_set(ChangeSetName=ref['id']);print(json.dumps({'stack':stack,'executionStarted':True,'additions':len(changes)}))
elif mode=='--publish-code':
 current=cfn.describe_stacks(StackName=stack)['Stacks'][0];assert current['StackStatus']=='CREATE_COMPLETE';check_existing(allow_published=True)
 order=['staging-wizz-wallet-service','staging-wizz-wallet-lifecycle','OrderService-staging','WaveSystem_HandleDriverAccept','staging-account-deletion-requests','staging-account-deletion-worker','staging-account-deletion-financial-expiry','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','DriversApi-staging','order-receiver-regional-staging-unified-auth-v4-sam','staging-wizz-wallet-notification-worker']
 results=[]
 try:
  for name in order:
   f=next(x for x in manifest['functions'] if x['name']==name);current=lam.get_function_configuration(FunctionName=name)
   if current['CodeSha256']==f['zip']['codeSha256']:results.append({'name':name,'alreadyPublished':True});continue
   assert current['RevisionId']==f['baseRevisionId'] and current['CodeSha256']==f['baseCodeSha256'];assert digest(current.get('Environment',{}).get('Variables',{}))==digest(environment(name))
   obj=next(o for o in plan['uploads'] if o.get('name')==name);r=lam.update_function_code(FunctionName=name,S3Bucket=plan['bucket'],S3Key=obj['key'],RevisionId=current['RevisionId'],Publish=False);assert r['CodeSha256']==f['zip']['codeSha256'];lam.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':1,'MaxAttempts':60})
   fresh=lam.get_function_configuration(FunctionName=name);assert fresh['CodeSha256']==f['zip']['codeSha256'];assert digest(fresh.get('Environment',{}).get('Variables',{}))==digest(environment(name));results.append({'name':name,'revisionId':fresh['RevisionId'],'codeSha256':fresh['CodeSha256'],'environmentUnchanged':True});print(json.dumps(results[-1]),flush=True)
 finally:(root/'publication.json').write_text(json.dumps(results,indent=2)+'\n')
else:
 check_existing(allow_published=True)
 evidence=json.loads((root/'live-verification.json').read_text());assert evidence['financialActivation']=='OFF' and evidence['stageSnapshot']['temporaryStageRemoved']
 for f in manifest['functions']:
  current=lam.get_function_configuration(FunctionName=f['name']);assert current['CodeSha256']==f['zip']['codeSha256'];assert not any(k.startswith('FINANCIAL_') and k.endswith('_MODE') and v=='REQUIRED' for k,v in current.get('Environment',{}).get('Variables',{}).items())
 current=cfn.describe_stacks(StackName=stack)['Stacks'][0];assert current['StackStatus']=='CREATE_COMPLETE';outputs={x['OutputKey']:x['OutputValue'] for x in current['Outputs']};deployment=outputs['MerchantRoutesDeploymentId'];stage=api.get_stage(restApiId='ie7z8r4wc0',stageName='staging');assert stage['deploymentId'] in [plan['previousStageDeploymentId'],deployment],'STAGE_CHANGED_SINCE_REVIEW'
 if stage['deploymentId']!=deployment:api.update_stage(restApiId='ie7z8r4wc0',stageName='staging',patchOperations=[{'op':'replace','path':'/deploymentId','value':deployment}])
 print(json.dumps({'merchantStageDeployment':deployment,'previous':plan['previousStageDeploymentId'],'newFinancialModes':'OFF'}));(root/'stage-publication.json').write_text(json.dumps({'newDeployment':deployment,'previousDeployment':plan['previousStageDeploymentId']},indent=2)+'\n')
