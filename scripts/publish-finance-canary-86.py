"""Activate exactly one user-selected Staging test order. No fabricated human session or order.
Scopes are installed on all coordinated hosts before opening any financial gate; Quote admission opens last.
Configuration snapshots are retained. Do not restore/remove a scope containing a nonterminal order.
"""
import pathlib,json,importlib.util,subprocess,datetime
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance86');sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 plan=json.loads((O/'activation-plan.private.json').read_text());assert plan['orderCount']==1 and plan['driverCount']==1 and plan['customerCount']==1 and len(plan['functions'])==13
 assert datetime.datetime.fromisoformat(plan['admitUntil'].replace('Z','+00:00'))>datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=20),'REFRESH_PREPARATION_FIRST'
 s=m.session();l=s.client('lambda');db=s.resource('dynamodb');configs={};manifest={'account':plan['account'],'region':plan['region'],'functions':[]};target='arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept'
 for row in plan['functions']:
  name=row['name'];cfg=l.get_function_configuration(FunctionName=name);assert cfg['RevisionId']==row['revisionId'] and cfg['CodeSha256']==row['codeSha256'],'LIVE_DRIFT '+name;configs[name]=cfg;e={**cfg['Environment']['Variables'],**row['scopeChanges'],**row['gateChanges']}
  if name=='DriversApi-staging':
   assert cfg['Environment']['Variables'].get('FINANCIAL_ACCEPT_FUNCTION_ARN') in [None,target],'UNEXPECTED_DRIVER_TARGET';assert e.get('FINANCIAL_ACCEPT_FUNCTION_ARN')==target,'DRIVER_TARGET_NOT_CONFIGURED'
   assert s.client('iam').simulate_principal_policy(PolicySourceArn=cfg['Role'],ActionNames=['lambda:InvokeFunction'],ResourceArns=[target])['EvaluationResults'][0]['EvalDecision']=='allowed','DRIVER_INVOKE_IAM_NOT_READY'
  if name=='staging-cod-integration':assert e.get('FINANCIAL_COD_ACCOUNT_ID')=='699561669180','INTEGRATION_ACCOUNT_NOT_CONFIGURED'
  manifest['functions'].append({'name':name,'arn':cfg['FunctionArn'],'env':{**e,'AWS_REGION':'us-east-1'}})
 for scope in plan['scope']['scopes']:
  for order in scope['orders']:assert not db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+order['orderId'],'SK':'META'},ConsistentRead=True).get('Item'),'CANARY_ORDER_ALREADY_EXISTS'
 p=O/'candidate-environments.private.json';p.write_text(json.dumps(manifest,indent=2));p.chmod(0o600);check=json.loads(subprocess.check_output(['node','scripts/check-finance-rollout-deployment.cjs',str(p)],cwd=R));assert check['scopeAgreement']
 events=s.client('events');rules=events.list_rule_names_by_target(TargetArn=configs['staging-cod-integration']['FunctionArn'])['RuleNames'];assert len(rules)==1,'EXACT_INTEGRATION_SCHEDULE_REQUIRED';schedule=events.describe_rule(Name=rules[0]);assert schedule['ScheduleExpression']=='rate(1 minute)';assert configs['staging-cod-integration']['Environment']['Variables'].get('DISPATCH_REVIEW_EXECUTION_MODE','OFF')=='OFF','REVIEW_MUST_REMAIN_OFF';(O/'schedule-before.json').write_text(json.dumps({'name':rules[0],'state':schedule['State'],'schedule':schedule['ScheduleExpression']}))
 result={'part':86,'orderCount':1,'customerCount':1,'driverCount':1,'branchCount':1,'admitUntil':plan['admitUntil'],'codeChanged':False,'applicationOrdersCreated':False,'scopeAgreementValidated':True,'functions':[],'activationComplete':False}
 save=lambda:(O/'publication.json').write_text(json.dumps(result,indent=2))
 def update(row,delta,phase):
  name=row['name'];before=configs[name];live=l.get_function_configuration(FunctionName=name);assert live['RevisionId']==before['RevisionId'] and live['CodeSha256']==row['codeSha256'],'LIVE_DRIFT '+name
  env={**before['Environment']['Variables'],**delta};l.update_function_configuration(FunctionName=name,RevisionId=before['RevisionId'],Environment={'Variables':env});l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':1,'MaxAttempts':90});after=l.get_function_configuration(FunctionName=name);assert after['Environment']['Variables']==env and after['CodeSha256']==before['CodeSha256']
  for f in ['Role','Runtime','Handler','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig']:assert before.get(f)==after.get(f),(name,f)
  configs[name]=after;result['functions'].append({'name':name,'phase':phase,'changedEnvironmentKeys':list(delta),'codeSha256':after['CodeSha256'],'otherConfigurationPreserved':True});save();print(json.dumps({'configured':name,'phase':phase}),flush=True)
 for row in plan['functions']:update(row,row['scopeChanges'],'SCOPE_ONLY')
 priorities=['staging-driver-financial-accept','DriversApi-staging','staging-wizz-wallet-notification-worker','staging-cod-integration','WaveSystem_StartWave','WizzUser-CreateOrder-staging','WizzUser-DeliveryQuotes-staging']
 for name in priorities:
  row=next(x for x in plan['functions'] if x['name']==name);update(row,row['gateChanges'],'BOUNDED_CANARY_GATE')
  if name=='staging-cod-integration':
   events.enable_rule(Name=rules[0]);assert events.describe_rule(Name=rules[0])['State']=='ENABLED';result['integrationScheduleEnabled']=True;save()
 r=l.invoke(FunctionName='WizzUser-DeliveryQuotes-staging',Payload=json.dumps({'httpMethod':'POST','headers':{},'body':'{}'}).encode());body=json.loads(r['Payload'].read());assert not r.get('FunctionError') and body['statusCode']==401,body
 result.update(activationComplete=True,anonymousQuoteRejected=True,financialScope='ONE_EXACT_ORDER_ONLY',scheduledIntegrationEnabled=True);save();print(json.dumps({'activationComplete':True,'orderCount':1,'anonymousQuoteRejected':True,'admitUntil':plan['admitUntil']}))
if __name__=='__main__':main()
