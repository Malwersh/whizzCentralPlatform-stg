"""Staging-only additive quote infrastructure and minimal merchant readiness publication. No activation."""
import argparse,base64,hashlib,json,secrets,time,urllib.request,urllib.error
from pathlib import Path
import boto3

ACCOUNT='699561669180';API='4jut6787c8';STACK='staging-delivery-quotes'
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def run(a):
 root=Path(a.release).resolve();audit=Path(a.audit).resolve();m=json.loads((root/'manifest.json').read_text());state=json.loads((audit/'state.json').read_text())
 assert m['account']==ACCOUNT and m['region']=='us-east-1' and not m['quoteEnabled'] and m['financialActivation']=='OFF'
 s=boto3.Session(profile_name=a.profile,region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']==ACCOUNT
 cfn=s.client('cloudformation');lam=s.client('lambda');api=s.client('apigateway');ddb=s.client('dynamodb');store=s.client('s3');iam=s.client('iam')
 template=json.loads((root/'quote.template.json').read_text());assert template==json.loads((Path(__file__).resolve().parents[1]/m['stack']['sourceTemplate']).read_text())
 def closed():
  for name in ['DriversApi-staging','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept','staging-cod-integration']:
   env=lam.get_function_configuration(FunctionName=name).get('Environment',{}).get('Variables',{})
   assert all(v=='OFF' for k,v in env.items() if k.startswith('FINANCIAL_') and k.endswith('_MODE'))
  env=lam.get_function_configuration(FunctionName='WizzUser-CreateOrder-staging').get('Environment',{}).get('Variables',{})
  assert env.get('DELIVERY_QUOTE_MODE','OFF')=='OFF' and env.get('COMMERCIAL_PRICING_MODE','OFF')=='OFF'
 def merchant(allow_published=False):
  f=m['merchant'];c=lam.get_function_configuration(FunctionName=f['name']);before=json.loads((audit/(f['name']+'.configuration.private.json')).read_text());assert c.get('Environment',{})==before.get('Environment',{});assert c['Handler']==f['handler']
  if not(allow_published and c['CodeSha256']==f['codeSha256']):assert c['RevisionId']==f['revisionId'] and c['CodeSha256']==state['merchantFunction']['codeSha256']
  return c
 def upload(file,key):
  data=(root/file).read_bytes();store.put_object(Bucket=m['stack']['parameters']['QuoteCodeBucket'],Key=key,Body=data,ExpectedBucketOwner=ACCOUNT,ServerSideEncryption='AES256');return data
 closed()
 if a.mode=='review':
  merchant();assert api.get_stage(restApiId=API,stageName='staging')['deploymentId']==m['previousCustomerDeployment']
  assert not any(x['path'] in ['/delivery-quotes','/orders/commercial-preview'] for x in api.get_resources(restApiId=API,limit=500)['items'])
  try:ddb.describe_table(TableName='staging-DeliveryQuotes');raise AssertionError('QUOTE_TABLE_ALREADY_EXISTS')
  except ddb.exceptions.ResourceNotFoundException:pass
  try:lam.get_function(FunctionName='WizzUser-DeliveryQuotes-staging');raise AssertionError('QUOTE_FUNCTION_ALREADY_EXISTS')
  except lam.exceptions.ResourceNotFoundException:pass
  data=(root/'quote.candidate.zip').read_bytes();assert base64.b64encode(hashlib.sha256(data).digest()).decode()==m['quote']['codeSha256'];assert m['stack']['parameters']['QuoteCodeKey']=='cod29/'+hashlib.sha256(data).hexdigest()+'.zip';upload('quote.candidate.zip',m['stack']['parameters']['QuoteCodeKey'])
  r=cfn.create_change_set(StackName=STACK,ChangeSetName='cod29-'+str(int(time.time())),ChangeSetType='CREATE',TemplateBody=json.dumps(template),Parameters=[{'ParameterKey':k,'ParameterValue':v} for k,v in m['stack']['parameters'].items()],Capabilities=['CAPABILITY_IAM'],Tags=[{'Key':'Environment','Value':'staging'},{'Key':'Release','Value':'COD29'}])
  (root/'changeset.json').write_text(json.dumps({'id':r['Id'],'templateDigest':digest(template)},indent=2)+'\n')
  for _ in range(60):
   review=cfn.describe_change_set(ChangeSetName=r['Id'])
   if review['Status']=='CREATE_COMPLETE':break
   assert review['Status']!='FAILED',review.get('StatusReason');time.sleep(2)
  else:raise RuntimeError('CHANGESET_REVIEW_TIMEOUT')
  changes=[x['ResourceChange'] for x in review['Changes']];assert len(changes)==15 and {x['LogicalResourceId'] for x in changes}==set(m['stack']['resources']);assert all(x['Action']=='Add' for x in changes);assert not any(x['ResourceType'] in ['AWS::ApiGateway::RestApi','AWS::ApiGateway::Stage','AWS::ApiGateway::Authorizer','AWS::IAM::Policy'] for x in changes)
  (root/'review.json').write_text(json.dumps([{'id':x['LogicalResourceId'],'type':x['ResourceType'],'action':x['Action']} for x in changes],indent=2)+'\n');print(json.dumps({'reviewedAdditions':len(changes),'quoteEnabled':False}));return
 if a.mode=='execute-stack':
  merchant();ref=json.loads((root/'changeset.json').read_text());assert ref['templateDigest']==digest(template);review=cfn.describe_change_set(ChangeSetName=ref['id']);assert review['Status']=='CREATE_COMPLETE';changes=[x['ResourceChange'] for x in review['Changes']];assert len(changes)==15 and {x['LogicalResourceId'] for x in changes}==set(template['Resources']) and all(x['Action']=='Add' for x in changes)
  cfn.execute_change_set(ChangeSetName=ref['id']);print(json.dumps({'stackExecutionStarted':True,'additions':15}));return
 stack=cfn.describe_stacks(StackName=STACK)['Stacks'][0];assert stack['StackStatus']=='CREATE_COMPLETE';outputs={x['OutputKey']:x['OutputValue'] for x in stack['Outputs']}
 if a.mode=='publish-merchant':
  current=merchant();data=(root/'merchant.candidate.zip').read_bytes();assert base64.b64encode(hashlib.sha256(data).digest()).decode()==m['merchant']['codeSha256'];key='cod29/'+hashlib.sha256(data).hexdigest()+'.zip';upload('merchant.candidate.zip',key)
  lam.update_function_code(FunctionName=m['merchant']['name'],S3Bucket=m['stack']['parameters']['QuoteCodeBucket'],S3Key=key,RevisionId=current['RevisionId'],Publish=False);lam.get_waiter('function_updated_v2').wait(FunctionName=m['merchant']['name'],WaiterConfig={'Delay':1,'MaxAttempts':60});fresh=merchant(True);assert fresh['CodeSha256']==m['merchant']['codeSha256'];(root/'merchant-publication.json').write_text(json.dumps({'name':fresh['FunctionName'],'codeSha256':fresh['CodeSha256'],'revisionId':fresh['RevisionId'],'environmentUnchanged':True},indent=2)+'\n');print('Merchant readiness code verified');return
 merchant(True);assert merchant(True)['CodeSha256']==m['merchant']['codeSha256'];quote=lam.get_function_configuration(FunctionName=m['quote']['name']);assert quote['CodeSha256']==m['quote']['codeSha256'];env=quote['Environment']['Variables'];assert env['DELIVERY_QUOTES_ENABLED']=='false' and env['DELIVERY_QUOTE_MAX_PER_MINUTE']=='' and env['MAPBOX_SECRET_ARN']==''
 checks=[]
 for event,status,code in [({'httpMethod':'POST','body':'{}'},503,'QUOTES_NOT_ENABLED'),({'httpMethod':'GET'},503,'QUOTES_NOT_ENABLED'),({'httpMethod':'OPTIONS'},204,None)]:
  r=lam.invoke(FunctionName=m['quote']['name'],InvocationType='RequestResponse',Payload=json.dumps(event).encode());assert not r.get('FunctionError');reply=json.load(r['Payload']);assert reply['statusCode']==status
  if code:assert json.loads(reply['body'])['code']==code
  checks.append({'method':event['httpMethod'],'statusCode':status,'code':code})
 c=lam.invoke(FunctionName=m['merchant']['name'],InvocationType='RequestResponse',Payload=b'{"httpMethod":"OPTIONS"}');assert not c.get('FunctionError') and json.load(c['Payload'])['statusCode']==204
 table=ddb.describe_table(TableName='staging-DeliveryQuotes')['Table'];assert table['KeySchema']==[{'AttributeName':'pk','KeyType':'HASH'},{'AttributeName':'sk','KeyType':'RANGE'}];assert ddb.describe_time_to_live(TableName='staging-DeliveryQuotes')['TimeToLiveDescription']['TimeToLiveStatus']=='DISABLED';assert ddb.describe_continuous_backups(TableName='staging-DeliveryQuotes')['ContinuousBackupsDescription']['PointInTimeRecoveryDescription']['PointInTimeRecoveryStatus']=='ENABLED'
 iam_checks=[];arn=lambda t:'arn:aws:dynamodb:us-east-1:'+ACCOUNT+':table/'+t
 for action,res,key,expected in [('dynamodb:GetItem',arn('staging-DeliveryQuotes'),'CUSTOMER#cod29','allowed'),('dynamodb:PutItem',arn('staging-DeliveryQuotes'),'CUSTOMER#cod29','allowed'),('dynamodb:ConditionCheckItem',arn('staging-DeliveryQuotes'),'CUSTOMER#cod29','allowed'),('dynamodb:UpdateItem',arn('staging-DeliveryQuotes'),'CUSTOMER#cod29','implicitDeny'),('dynamodb:DeleteItem',arn('staging-DeliveryQuotes'),'CUSTOMER#cod29','implicitDeny'),('dynamodb:PutItem',arn('staging-DeliveryQuotes'),'PERSON#cod29','implicitDeny'),('dynamodb:PutItem',arn('WizzOrders'),'ORDER#cod29','implicitDeny'),('dynamodb:UpdateItem',arn('staging-Wallets'),'WALLET#PLATFORM','implicitDeny'),('dynamodb:PutItem',arn('staging-LedgerEntries'),'WALLET#PLATFORM','implicitDeny'),('dynamodb:GetItem',arn('staging-PlatformStaff'),'OPERATIONAL_SETTINGS#DELIVERY_PRICING','allowed'),('dynamodb:GetItem',arn('staging-PlatformStaff'),'PERSON#cod29','implicitDeny')]:
  result=iam.simulate_principal_policy(PolicySourceArn=quote['Role'],ActionNames=[action],ResourceArns=[res],ContextEntries=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[key]}])['EvaluationResults'][0]['EvalDecision'];assert result==expected,(action,res,result);iam_checks.append({'action':action,'resource':res,'key':key,'decision':result})
 stage=api.get_stage(restApiId=API,stageName='staging');assert stage['deploymentId'] in [m['previousCustomerDeployment'],outputs['QuoteApiDeploymentId']];temporary='cod29-review-'+secrets.token_hex(5)
 def export(name):return json.load(api.get_export(restApiId=API,stageName=name,exportType='oas30',parameters={'extensions':'integrations'})['body'])
 try:
  api.create_stage(restApiId=API,stageName=temporary,deploymentId=outputs['QuoteApiDeploymentId']);current=export('staging');after=export(temporary);before=json.loads((audit/'customer-api.private.json').read_text())['export']
  assert digest(current['paths'])==digest((before if stage['deploymentId']==m['previousCustomerDeployment'] else after)['paths'])
  assert set(after['paths'])-set(before['paths'])=={'/delivery-quotes','/orders/commercial-preview'} and not set(before['paths'])-set(after['paths']);assert all(digest(before['paths'][p])==digest(after['paths'][p]) for p in before['paths']),'OLD_API_PATH_CHANGED'
  for path,verbs in [('/delivery-quotes',['get','post']),('/orders/commercial-preview',['post'])]:
   for verb in verbs:assert after['paths'][path][verb]['security']==[{'CognitoAuthorizer':['aws.cognito.signin.user.admin']}]
 finally:api.delete_stage(restApiId=API,stageName=temporary)
 evidence={'quoteFunction':{'name':quote['FunctionName'],'codeSha256':quote['CodeSha256'],'revisionId':quote['RevisionId'],'enabled':False},'quoteRuntimeChecks':checks,'iam':iam_checks,'table':{'name':table['TableName'],'pitr':'ENABLED','ttl':'DISABLED'},'apiSnapshot':{'oldDeployment':m['previousCustomerDeployment'],'newDeployment':outputs['QuoteApiDeploymentId'],'oldPathsUnchanged':len(before['paths']),'newPaths':['/delivery-quotes','/orders/commercial-preview'],'temporaryStageRemoved':True},'financialActivation':'OFF'}
 (root/'verification-before-switch.json').write_text(json.dumps(evidence,indent=2)+'\n');closed();assert lam.get_function_configuration(FunctionName=m['quote']['name'])['Environment']['Variables']['DELIVERY_QUOTES_ENABLED']=='false';assert api.get_stage(restApiId=API,stageName='staging')['deploymentId']==stage['deploymentId'];
 if stage['deploymentId']!=outputs['QuoteApiDeploymentId']:api.update_stage(restApiId=API,stageName='staging',patchOperations=[{'op':'replace','path':'/deploymentId','value':outputs['QuoteApiDeploymentId']}])
 assert api.get_stage(restApiId=API,stageName='staging')['deploymentId']==outputs['QuoteApiDeploymentId']
 http=[]
 for method,path,body,expected in [('GET','/delivery-quotes',None,401),('POST','/delivery-quotes',{},401),('POST','/orders/commercial-preview',{},401),('OPTIONS','/delivery-quotes',None,200),('OPTIONS','/orders/commercial-preview',None,200),('POST','/orders',{'quoteId':'cod29-closed'},409),('OPTIONS','/orders',None,200)]:
  request=urllib.request.Request('https://'+API+'.execute-api.us-east-1.amazonaws.com/staging'+path,method=method,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'})
  for retry in range(30):
   try:
    with urllib.request.urlopen(request,timeout=25) as response:status=response.status
   except urllib.error.HTTPError as e:status=e.code
   if status==expected:break
   time.sleep(2)
  assert status==expected,(method,path,status);http.append({'method':method,'path':path,'statusCode':status})
 evidence['http']=http;evidence['stageSwitched']=True;evidence['humanDataAccess']=False;evidence['otpOrPushSent']=False;(root/'publication.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps({'oldPathsUnchanged':len(before['paths']),'newPaths':2,'iamChecks':len(iam_checks),'httpChecks':len(http),'quoteEnabled':False}))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('audit');p.add_argument('release');p.add_argument('mode',choices=['review','execute-stack','publish-merchant','verify-and-switch']);p.add_argument('--profile',default='Wizz_stg_UserApp');run(p.parse_args())
