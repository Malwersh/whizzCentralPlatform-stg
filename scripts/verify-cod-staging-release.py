#!/usr/bin/env python3
"""Verify deployed closed gates, hashes, IAM boundaries and safe merchant API snapshot. No financial writes."""
import boto3,json,hashlib,sys,secrets
from pathlib import Path
root=Path(sys.argv[1]);audit=Path(sys.argv[2]);s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';lam=s.client('lambda');iam=s.client('iam');api=s.client('apigateway');cfn=s.client('cloudformation');m=json.loads((root/'manifest.json').read_text());r={'functions':[],'iam':[],'invocations':{},'stageSnapshot':{},'financialActivation':'OFF'}
def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True).encode()).hexdigest()
configs={}
for f in m['functions']:
 c=lam.get_function_configuration(FunctionName=f['name']);assert c['CodeSha256']==f['zip']['codeSha256'];configs[f['name']]=c;env=c.get('Environment',{}).get('Variables',{})
 if not f.get('newFunction'):
  old=json.loads((audit/(f['name']+'.configuration.private.json')).read_text());assert env==old.get('Environment',{}).get('Variables',{})
 assert not any(k.startswith('FINANCIAL_') and k.endswith('_MODE') and v=='REQUIRED' for k,v in env.items());r['functions'].append({'name':f['name'],'revisionId':c['RevisionId'],'codeSha256':c['CodeSha256'],'role':c['Role'],'runtime':c['Runtime'],'newFunction':bool(f.get('newFunction')),'closed':True})
for name,event,expected in [('staging-driver-financial-accept',{'action':'accept','body':{'orderId':'cod26-probe','offerId':'FINO:cod26-probe','waveNumber':1},'accessToken':'invalid'},{'statusCode':409,'code':'FINANCIAL_DISPATCH_DISABLED'}),('staging-cod-integration',{}, {'disabled':True,'processed':0}),('staging-wizz-wallet-notification-worker',{'Records':[]},{'batchItemFailures':[]})]:
 reply=lam.invoke(FunctionName=name,InvocationType='RequestResponse',Payload=json.dumps(event).encode());data=json.loads(reply['Payload'].read());assert not reply.get('FunctionError') and data==expected,(name,data);r['invocations'][name]=data
arn=lambda t:'arn:aws:dynamodb:us-east-1:699561669180:table/'+t
cases=[('staging-cod-integration','dynamodb:Query',arn('staging-WalletLifecycle')+'/index/ByDue','COD_INTEGRATION','allowed'),('staging-cod-integration','dynamodb:UpdateItem',arn('staging-WalletLifecycle'),'CDA:'+'a'*48+':EVENT','allowed'),('staging-cod-integration','dynamodb:UpdateItem',arn('staging-Wallets'),'WALLET#DRIVER#cod26','implicitDeny'),('staging-cod-integration','dynamodb:PutItem',arn('staging-LedgerEntries'),'WALLET#DRIVER#cod26','implicitDeny'),('staging-cod-integration','dynamodb:DeleteItem',arn('staging-WalletLifecycle'),'CDA:'+'a'*48+':EVENT','implicitDeny'),('staging-driver-financial-accept','dynamodb:UpdateItem',arn('staging-Wallets'),'WALLET#DRIVER#cod26','allowed'),('staging-driver-financial-accept','dynamodb:PutItem',arn('staging-Wallets'),'WALLET#DRIVER#cod26','implicitDeny'),('staging-driver-financial-accept','dynamodb:PutItem',arn('WizzOrders'),'ORDER#cod26','implicitDeny'),('staging-driver-financial-accept','dynamodb:UpdateItem',arn('staging-PlatformStaff'),'OPERATIONAL_SETTINGS#DELIVERY_PRICING','implicitDeny'),('staging-driver-financial-accept','dynamodb:GetItem',arn('staging-PlatformStaff'),'OPERATIONAL_SETTINGS#DELIVERY_PRICING','allowed'),('DriversApi-staging','lambda:InvokeFunction','arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept',None,'allowed'),('staging-account-deletion-requests','dynamodb:Scan',arn('staging-WalletLifecycle'),None,'allowed'),('staging-account-deletion-worker','dynamodb:ConditionCheckItem',arn('staging-WalletLifecycle'),'CDA:'+'a'*48+':EVENT','allowed'),('staging-account-deletion-financial-expiry','dynamodb:DeleteItem',arn('WaveOffers_staging'),'cod26','allowed')]
for name,action,resource,leading,expected in cases:
 args={'PolicySourceArn':configs[name]['Role'],'ActionNames':[action],'ResourceArns':[resource]}
 if leading:args['ContextEntries']=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyValues':[leading],'ContextKeyType':'stringList'}]
 result=iam.simulate_principal_policy(**args)['EvaluationResults'][0]['EvalDecision'];assert result==expected,(name,action,result,expected);r['iam'].append({'function':name,'action':action,'resource':resource,'decision':result})
stack=cfn.describe_stacks(StackName='staging-cod-lifecycle')['Stacks'][0];assert stack['StackStatus']=='CREATE_COMPLETE';outputs={x['OutputKey']:x['OutputValue'] for x in stack['Outputs']};new=outputs['MerchantRoutesDeploymentId'];old=api.get_stage(restApiId='ie7z8r4wc0',stageName='staging')['deploymentId'];plan=json.loads((root/'deployment-plan.json').read_text());assert old==plan['previousStageDeploymentId']
# Read-only query proves the existing due index is usable, without returning financial records.
due=s.client('dynamodb').query(TableName='staging-WalletLifecycle',IndexName='ByDue',KeyConditionExpression='queuePartition = :q AND nextAttemptAt <= :at',ExpressionAttributeValues={':q':{'S':'COD_INTEGRATION'},':at':{'N':'0'}},Select='COUNT',Limit=1);r['dueIndex']={'queried':True,'evaluated':due.get('ScannedCount',0),'returnedRecords':False}
temp='cod26-review-'+secrets.token_hex(5)
def export(stage):return json.loads(api.get_export(restApiId='ie7z8r4wc0',stageName=stage,exportType='oas30',parameters={'extensions':'integrations'})['body'].read())
try:
 api.create_stage(restApiId='ie7z8r4wc0',stageName=temp,deploymentId=new)
 before=export('staging');after=export(temp);oldpaths=before['paths'];newpaths=after['paths'];expected={'/auth/order-returns','/auth/order-cancellation'}
 assert set(newpaths)-set(oldpaths)==expected,'UNEXPECTED_NEW_API_PATHS';assert not set(oldpaths)-set(newpaths),'EXISTING_API_PATH_REMOVED'
 changed=[p for p in oldpaths if digest(oldpaths[p])!=digest(newpaths[p])];assert not changed,('EXISTING_API_METHOD_CHANGED',changed)
 r['stageSnapshot']={'oldDeployment':old,'newDeployment':new,'existingPathsUnchanged':len(oldpaths),'newPaths':sorted(expected),'temporaryStageRemoved':False}
finally:api.delete_stage(restApiId='ie7z8r4wc0',stageName=temp)
r['stageSnapshot']['temporaryStageRemoved']=True
(root/'live-verification.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'functionsVerified':len(r['functions']),'iamChecks':len(r['iam']),'stageSnapshot':r['stageSnapshot'],'financialActivation':'OFF'}))
