"""Limited Staging publication. Never changes financial activation, employees, orders or wallets."""
import base64,hashlib,json,time,uuid
from pathlib import Path
import boto3
root=Path('/private/tmp/cod32-release');audit=Path('/private/tmp/cod32-live');s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';c=s.client('cloudformation');l=s.client('lambda');ddb=s.resource('dynamodb');iam=s.client('iam');store=s.client('s3');results={}
def closed():
 for n in ['DriversApi-staging','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept','staging-cod-integration']:
  env=l.get_function_configuration(FunctionName=n).get('Environment',{}).get('Variables',{});assert all(v=='OFF' for k,v in env.items() if k.startswith('FINANCIAL_') and k.endswith('_MODE'))
 assert l.get_function_configuration(FunctionName='WizzUser-DeliveryQuotes-staging')['Environment']['Variables']['DELIVERY_QUOTES_ENABLED']=='false'
closed()
values={'quoteMaxPerCustomerPerMinute':5,'driverOfferTtlSeconds':60,'driverPositionMaxAgeSeconds':120,'reassignmentWindowSeconds':300,'maximumWaves':4};pk='OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS';table=ddb.Table('staging-PlatformStaff');old=table.get_item(Key={'pk':pk,'sk':'CURRENT'},ConsistentRead=True).get('Item')
if old:assert old['version']==1 and old['values']==values
else:
 from boto3.dynamodb.types import TypeSerializer
 ser=TypeSerializer();enc=lambda x:{k:ser.serialize(v) for k,v in x.items()};identifier=str(uuid.uuid4());row={'pk':pk,'sk':'CURRENT','version':1,'policyVersion':identifier,'values':values,'initializedBy':'SYSTEM_RELEASE_32','initializationSource':'USER_APPROVED_PART31','effectiveFor':'NEW_QUOTES_OFFERS_AND_SEARCH_WINDOWS'};version={**row,'sk':'VERSION#'+identifier};event={'pk':'AUDIT','sk':'SYSTEM_RELEASE_32#'+identifier,'actorId':'SYSTEM_RELEASE_32','action':'DELIVERY_OPERATIONS_INITIALIZED','after':row,'reason':'Preserve user-approved part31 values; financial activation remains OFF'}
 s.client('dynamodb').transact_write_items(TransactItems=[{'Put':{'TableName':table.name,'Item':enc(r),'ConditionExpression':'attribute_not_exists(pk) AND attribute_not_exists(sk)'}} for r in [row,version,event]])
results['policy']={'version':1,'values':values,'humanGrantsChanged':False};print('Approved part31 values initialized',flush=True)
for p in json.load(open(root/'changesets.json')):
 r=c.describe_change_set(ChangeSetName=p['changeSetId']);assert r['Status']=='CREATE_COMPLETE' and r['ExecutionStatus']=='AVAILABLE';expected=set(['Cod26WaveSystemStartWaveFunctionGuardPolicy','DriverFinancialAcceptanceFunctionRole','DriverFinancialAcceptanceFunction']) if p['stack'].endswith('lifecycle') else set(['DeliveryQuoteRole','DeliveryQuotesFunction','QuoteGetMethod','QuotePostMethod','QuoteGetPermission','QuotePostPermission'])
 assert {v['ResourceChange']['LogicalResourceId'] for v in r['Changes']}==expected
 for v in r['Changes']:
  x=v['ResourceChange'];assert x['Action']=='Modify'
  if x['LogicalResourceId'].endswith('Permission'):
   assert x['Replacement']=='Conditional' and all(d['Evaluation']=='Dynamic' and d['CausingEntity']=='DeliveryQuotesFunction.Arn' for d in x['Details'])
  else:assert x['Replacement']=='False'
 c.execute_change_set(ChangeSetName=p['changeSetId']);c.get_waiter('stack_update_complete').wait(StackName=p['stack'],WaiterConfig={'Delay':2,'MaxAttempts':150});print(p['stack'],'updated',flush=True)
results['infrastructure']='UPDATE_COMPLETE';closed()
checks=[]
for n in ['WaveSystem_StartWave','staging-driver-financial-accept','WizzUser-DeliveryQuotes-staging']:
 role=l.get_function_configuration(FunctionName=n)['Role']
 for action,key,expected in [('dynamodb:GetItem',pk,'allowed'),('dynamodb:ConditionCheckItem',pk,'allowed'),('dynamodb:GetItem','EMPLOYEE#synthetic-forbidden','implicitDeny')]:
  decision=iam.simulate_principal_policy(PolicySourceArn=role,ActionNames=[action],ResourceArns=['arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff'],ContextEntries=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[key]}])['EvaluationResults'][0]['EvalDecision'];assert decision==expected,(n,action,decision);checks.append({'function':n,'action':action,'keyClass':'operating-policy' if key==pk else 'unrelated-staff','decision':decision})
results['iam']=checks;published=[]
for f in json.load(open(root/'manifest.json'))['functions']:
 fresh=l.get_function_configuration(FunctionName=f['name']);assert fresh['CodeSha256']==f['baseCodeSha256'] and fresh['Handler']==f['handler'],'LIVE_CODE_DRIFT';before=json.load(open(audit/(f['name']+'.private.json')));env=fresh.get('Environment',{}).get('Variables',{});oldenv=before.get('Environment',{}).get('Variables',{});assert {k:v for k,v in env.items() if k!='DELIVERY_OPERATIONS_MODE'}=={k:v for k,v in oldenv.items() if k!='DELIVERY_OPERATIONS_MODE'},'UNRELATED_ENV_DRIFT'
 data=(root/(f['name']+'.zip')).read_bytes();assert base64.b64encode(hashlib.sha256(data).digest()).decode()==f['codeSha256'];bucket='aws-sam-cli-managed-default-samclisourcebucket-c0s0eilxsprc';key='cod32/code/'+hashlib.sha256(data).hexdigest()+'.zip';store.put_object(Bucket=bucket,Key=key,Body=data,ExpectedBucketOwner='699561669180',ServerSideEncryption='AES256');l.update_function_code(FunctionName=f['name'],RevisionId=fresh['RevisionId'],S3Bucket=bucket,S3Key=key);l.get_waiter('function_updated_v2').wait(FunctionName=f['name'],WaiterConfig={'Delay':1,'MaxAttempts':90})
 if f['name'].startswith('WaveSystem_'):
  fresh=l.get_function_configuration(FunctionName=f['name']);env=fresh['Environment']['Variables'];env['DELIVERY_OPERATIONS_MODE']='CENTRAL';l.update_function_configuration(FunctionName=f['name'],RevisionId=fresh['RevisionId'],Environment={'Variables':env});l.get_waiter('function_updated_v2').wait(FunctionName=f['name'],WaiterConfig={'Delay':1,'MaxAttempts':90})
 after=l.get_function_configuration(FunctionName=f['name']);assert after['CodeSha256']==f['codeSha256'];published.append({'name':f['name'],'codeSha256':after['CodeSha256'],'revisionId':after['RevisionId']});results['functions']=published;(root/'publication.json').write_text(json.dumps(results,indent=2)+'\n');print(f['name'],'verified',flush=True)
closed();results['financialActivation']='OFF';results['humanOrdersAndFundsChanged']=False;(root/'publication.json').write_text(json.dumps(results,indent=2)+'\n');print('Closed activation preserved',flush=True)
