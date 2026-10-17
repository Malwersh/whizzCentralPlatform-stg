"""Publish reviewed code and approved numeric limits only; activation flags must remain OFF."""
import argparse,base64,hashlib,json,time
from pathlib import Path
import boto3
p=argparse.ArgumentParser();p.add_argument('release');p.add_argument('audit');p.add_argument('--supplement',action='store_true');a=p.parse_args();root=Path(a.release);audit=Path(a.audit);m=json.load(open(root/'manifest.json'));assert m['stage']=='staging' and m['financialActivation']=='OFF' and (len(m['functions'])==6 if not a.supplement else [f['name'] for f in m['functions']]==['WaveSystem_CreateDispatchJob'])
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');store=s.client('s3');iam=s.client('iam');cfn=s.client('cloudformation')
for name in ['staging-cod-lifecycle','staging-delivery-quotes']:assert cfn.describe_stacks(StackName=name)['Stacks'][0]['StackStatus']=='UPDATE_COMPLETE'
limits={'FINANCIAL_OFFER_TTL_SECONDS':'60','FINANCIAL_POSITION_MAX_AGE_SECONDS':'120','FINANCIAL_REASSIGNMENT_WINDOW_SECONDS':'300'}
def closed():
 for name in ['DriversApi-staging','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept','staging-cod-integration']:
  e=l.get_function_configuration(FunctionName=name).get('Environment',{}).get('Variables',{});assert all(v=='OFF' for k,v in e.items() if k.startswith('FINANCIAL_') and k.endswith('_MODE'))
 q=l.get_function_configuration(FunctionName='WizzUser-DeliveryQuotes-staging')['Environment']['Variables'];assert q['DELIVERY_QUOTES_ENABLED']=='false' and q['DELIVERY_QUOTE_MAX_PER_MINUTE']=='5'
closed();results=[]
try:
 for f in m['functions']:
  fresh=l.get_function_configuration(FunctionName=f['name']);assert fresh['CodeSha256']==f['baseCodeSha256'] and fresh['Handler']==f['handler'],'LIVE_CODE_DRIFT'
  before=json.load(open(audit/(f['name']+'.private.json')));env=fresh.get('Environment',{}).get('Variables',{});old=before.get('Environment',{}).get('Variables',{});allowed=set(limits) if f['name'] in ['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept'] else set();assert {k:v for k,v in env.items() if k not in allowed}=={k:v for k,v in old.items() if k not in allowed},'UNRELATED_ENVIRONMENT_DRIFT'
  data=(root/(f['name']+'.zip')).read_bytes();assert base64.b64encode(hashlib.sha256(data).digest()).decode()==f['codeSha256'];key='cod31/'+hashlib.sha256(data).hexdigest()+'.zip';store.put_object(Bucket='aws-sam-cli-managed-default-samclisourcebucket-c0s0eilxsprc',Key=key,Body=data,ExpectedBucketOwner='699561669180',ServerSideEncryption='AES256')
  l.update_function_code(FunctionName=f['name'],S3Bucket='aws-sam-cli-managed-default-samclisourcebucket-c0s0eilxsprc',S3Key=key,RevisionId=fresh['RevisionId']);l.get_waiter('function_updated_v2').wait(FunctionName=f['name'],WaiterConfig={'Delay':1,'MaxAttempts':90})
  if f['name'] in ['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout']:
   current=l.get_function_configuration(FunctionName=f['name']);env=current['Environment']['Variables'];env.update(limits);assert env.get('FINANCIAL_DISPATCH_MODE','OFF')=='OFF';l.update_function_configuration(FunctionName=f['name'],RevisionId=current['RevisionId'],Environment={'Variables':env});l.get_waiter('function_updated_v2').wait(FunctionName=f['name'],WaiterConfig={'Delay':1,'MaxAttempts':90})
  after=l.get_function_configuration(FunctionName=f['name']);assert after['CodeSha256']==f['codeSha256'];results.append({'name':f['name'],'codeSha256':after['CodeSha256'],'revisionId':after['RevisionId'],'unrelatedEnvironmentPreserved':True});print(f['name'],'verified',flush=True)
 closed()
 for name in ['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept']:
  e=l.get_function_configuration(FunctionName=name)['Environment']['Variables'];assert all(e[k]==v for k,v in limits.items())
finally:(root/'code-publication.json').write_text(json.dumps({'functions':results,'financialActivation':'OFF'},indent=2)+'\n')
checks=[];role=l.get_function_configuration(FunctionName='WaveSystem_HandleWaveTimeout')['Role']
for action,table,key,expected in [('dynamodb:UpdateItem','WizzOrders','ORDER#synthetic','allowed'),('dynamodb:GetItem','staging-Holds','synthetic','allowed'),('dynamodb:ConditionCheckItem','staging-Holds','synthetic','allowed'),('dynamodb:UpdateItem','staging-Wallets','WALLET#PLATFORM','implicitDeny'),('dynamodb:UpdateItem','staging-Holds','synthetic','implicitDeny'),('dynamodb:PutItem','staging-LedgerEntries','WALLET#PLATFORM','implicitDeny')]:
 decision=iam.simulate_principal_policy(PolicySourceArn=role,ActionNames=[action],ResourceArns=['arn:aws:dynamodb:us-east-1:699561669180:table/'+table],ContextEntries=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[key]}])['EvaluationResults'][0]['EvalDecision'];assert decision==expected,(action,table,decision);checks.append({'action':action,'table':table,'decision':decision})
r=l.invoke(FunctionName='staging-driver-financial-accept',Payload=json.dumps({'accessToken':'synthetic-invalid-token','action':'accept','body':{}}).encode());assert not r.get('FunctionError');body=json.load(r['Payload']);assert body['statusCode']==409 and body['code']=='FINANCIAL_DISPATCH_DISABLED'
(root/'verification.json').write_text(json.dumps({'iam':checks,'financialActivation':'OFF','writerClosed':body,'humanOrdersChanged':False,'fundsChanged':False},indent=2)+'\n');print('Verified closed activation and timeout IAM boundaries',flush=True)
