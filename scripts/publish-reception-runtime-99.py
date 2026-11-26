"""Coordinated staging publication. Requires applied explicitly approved IAM policy artifact."""
from pathlib import Path
import json,zipfile,io,base64,hashlib,importlib.util
R=Path(__file__).resolve().parents[1];O=Path('/private/tmp/finance98');assert (O/'permissions99-applied.json').exists(),'EXPLICITLY_APPROVED_PERMISSIONS_REQUIRED';sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);s=m.session();l=s.client('lambda');events=s.client('events');ddb=s.client('dynamodb');api=s.client('apigateway');manifest=json.loads((O/'release99.manifest.private.json').read_text());state={'functions':[]};save=lambda:(O/'runtime99-publication.json').write_text(json.dumps(state,indent=2));scope=json.loads((O/'live/staging-driver-financial-accept.config.private.json').read_text())['Environment']['Variables'];finance={k:v for k,v in scope.items() if k.startswith('FINANCE_ROLLOUT_')}
def updated(name):l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':1,'MaxAttempts':60})
def env_add(name,values):
 c=l.get_function_configuration(FunctionName=name);v=c.get('Environment',{}).get('Variables',{});l.update_function_configuration(FunctionName=name,RevisionId=c['RevisionId'],Environment={'Variables':{**v,**values}});updated(name)
def publish(entry):
 name=entry['name'];c=l.get_function_configuration(FunctionName=name);assert c['RevisionId']==entry['baseRevisionId'],'LIVE_DRIFT '+name;data=Path(entry['candidate']).read_bytes();assert base64.b64encode(hashlib.sha256(data).digest()).decode()==entry['sha256'];l.update_function_code(FunctionName=name,RevisionId=c['RevisionId'],ZipFile=data);updated(name);a=l.get_function_configuration(FunctionName=name)
 for k in ['Environment','Role','Runtime','Handler','Timeout','Layers','Architectures']:assert a.get(k)==c.get(k)
 state['functions'].append(name);save();print(json.dumps({'published':name}),flush=True)
# Validate all base revisions before any runtime replacement. Staff API was published separately.
for entry in manifest:
 if entry['name']=='staging-wizz-staff-service':continue
 assert l.get_function_configuration(FunctionName=entry['name'])['RevisionId']==entry['baseRevisionId'],'LIVE_DRIFT '+entry['name']
# Notification paths become canonical/ownership-checked first.
for entry in manifest:
 if entry['name'].startswith('wizzcentral-notifications-staging-'):publish(entry)
env_add('wizzcentral-notifications-staging-pushSendOrderUpdate',{'ORDER_LIVE_ACTIVITY_UPDATES':'REQUIRED'})
# Read-only sound policy endpoint. Never expose the registration internal key in this function's environment.
name='wizzcentral-notifications-staging-pushSoundSettings';reg=json.loads((O/'live/wizzcentral-notifications-staging-pushTokensRegister.config.private.json').read_text());entry=next(x for x in manifest if x['name'].endswith('pushTokensRegister'));v={k:value for k,value in reg.get('Environment',{}).get('Variables',{}).items() if k=='STAGE' or k=='COGNITO_REGION' or k.endswith('_USER_POOL_ID') or k.endswith('_CLIENT_ID')}
try:l.get_function(FunctionName=name);raise RuntimeError('SOUND_FUNCTION_ALREADY_EXISTS_REVIEW_REQUIRED')
except l.exceptions.ResourceNotFoundException:pass
l.create_function(FunctionName=name,Runtime=reg['Runtime'],Role=reg['Role'],Handler='src/handlers/push-tokens.soundSettings',Code={'ZipFile':Path(entry['candidate']).read_bytes()},Timeout=10,MemorySize=256,Environment={'Variables':v},Architectures=reg.get('Architectures',['x86_64']));l.get_waiter('function_active_v2').wait(FunctionName=name)
# Resolve the existing push API by its registration Lambda integration, not an assumed API ID.
api_id=None;push_resource=None
for rest in api.get_rest_apis(limit=100)['items']:
 if 'notification' not in rest['name'].lower():continue
 resources=api.get_resources(restApiId=rest['id'],limit=500)['items'];register=next((r for r in resources if r.get('path')=='/push/tokens/register'),None)
 if not register:continue
 integration=api.get_integration(restApiId=rest['id'],resourceId=register['id'],httpMethod='POST')
 if 'wizzcentral-notifications-staging-pushTokensRegister' in integration.get('uri',''):api_id=rest['id'];push_resource=next(r for r in resources if r.get('path')=='/push');break
assert api_id and push_resource,'PUSH_API_NOT_FOUND';resource=api.create_resource(restApiId=api_id,parentId=push_resource['id'],pathPart='sounds');api.put_method(restApiId=api_id,resourceId=resource['id'],httpMethod='GET',authorizationType='NONE');uri='arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:699561669180:function:'+name+'/invocations';api.put_integration(restApiId=api_id,resourceId=resource['id'],httpMethod='GET',type='AWS_PROXY',integrationHttpMethod='POST',uri=uri);l.add_permission(FunctionName=name,StatementId='PushSoundsGet99',Action='lambda:InvokeFunction',Principal='apigateway.amazonaws.com',SourceArn=f'arn:aws:execute-api:us-east-1:699561669180:{api_id}/*/GET/push/sounds');previous=api.get_stage(restApiId=api_id,stageName='staging')['deploymentId'];api.create_deployment(restApiId=api_id,stageName='staging',description='Authenticated notification sound policy 99');state['soundApi']={'apiId':api_id,'priorDeploymentId':previous};save()
# Worker exists and stream subscription is live before new creators can enqueue work.
name='staging-merchant-response-99';buf=io.BytesIO()
with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('index.js',(O/'merchant_response_runtime.js').read_bytes())
l.create_function(FunctionName=name,Runtime='nodejs22.x',Role='arn:aws:iam::699561669180:role/'+name,Handler='index.handler',Code={'ZipFile':buf.getvalue()},Timeout=45,MemorySize=256,Environment={'Variables':{'STAGE':'staging','FINANCIAL_COD_ACCOUNT_ID':'699561669180','MERCHANT_RESPONSE_MODE':'REQUIRED',**finance}},Architectures=['x86_64']);l.get_waiter('function_active_v2').wait(FunctionName=name)
stream=ddb.describe_table(TableName='WizzOrders')['Table']['LatestStreamArn'];mapping=l.create_event_source_mapping(EventSourceArn=stream,FunctionName=name,Enabled=True,BatchSize=10,StartingPosition='LATEST',MaximumRetryAttempts=3,BisectBatchOnFunctionError=True,FilterCriteria={'Filters':[{'Pattern':json.dumps({'eventName':['INSERT'],'dynamodb':{'NewImage':{'merchantResponsePolicy':{'M':{'schemaVersion':{'N':['1']}}}}}})}]});state['workerStreamMapping']=mapping['UUID'];rule=events.put_rule(Name='staging-merchant-response-99',ScheduleExpression='rate(1 minute)',State='ENABLED',Description='Drain merchant deadlines and guarded timed pause resumes');l.add_permission(FunctionName=name,StatementId='MerchantResponseSchedule99',Action='lambda:InvokeFunction',Principal='events.amazonaws.com',SourceArn=rule['RuleArn']);events.put_targets(Rule='staging-merchant-response-99',Targets=[{'Id':'merchant-response','Arn':'arn:aws:lambda:us-east-1:699561669180:function:'+name}]);state['workerScheduled']=True;save()
# Merchant accept/reject paths and reads, preserving unrelated production-tested financial code.
for entry in manifest:
 if entry['name']=='staging-wizz-staff-service' or entry['name'].startswith('wizzcentral-notifications-staging-') or entry['name']=='WizzUser-CreateOrder-staging':continue
 publish(entry)
for name in ['order-receiver-merchant-orders-staging-v1','order-receiver-business-staging-status-v1-sam','order-receiver-regional-staging-unified-auth-v4-sam']:env_add(name,{'MERCHANT_RESPONSE_MODE':'REQUIRED',**finance})
# Verify worker mapping creation before enabling creation; scheduler also drains missed hints.
assert l.get_event_source_mapping(UUID=state['workerStreamMapping'])['State'] in ['Enabled','Creating','Enabling']
entry=next(x for x in manifest if x['name']=='WizzUser-CreateOrder-staging');publish(entry);env_add(entry['name'],{'MERCHANT_RESPONSE_MODE':'REQUIRED'});state['complete']=True;save();print(json.dumps({'coordinatedPublication':True,'existingFinancialScopesPreserved':True,'newAdmissionCreated':False}))
