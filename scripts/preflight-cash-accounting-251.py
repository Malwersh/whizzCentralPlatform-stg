"""Read-only live preflight. Every transaction in the Node scenario is intercepted locally."""
import sys,json,os,subprocess,pathlib,re
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];s=session();cfg=s.client('lambda').get_function_configuration(FunctionName='staging-wizz-staff-service');credentials=s.get_credentials().get_frozen_credentials();env=os.environ.copy();env.update(cfg.get('Environment',{}).get('Variables',{}));env.update(AWS_ACCESS_KEY_ID=credentials.access_key,AWS_SECRET_ACCESS_KEY=credentials.secret_key,AWS_SESSION_TOKEN=credentials.token or '',AWS_REGION='us-east-1');subprocess.run(['node','scripts/verify-cash-accounting-251.cjs'],cwd=r,env=env,check=True)
x=json.loads(pathlib.Path('/private/tmp/cash-accounting-251-preflight.private.json').read_text());iam=s.client('iam');results=[]
def simulate(action,p,kind):
 key=p.get('Key') or p.get('Item') or {};pk=key.get('pk',key.get('businessId',key.get('walletId',key.get('datePartition',key.get('orderId')))));attrs=set(key)|set(p.get('ExpressionAttributeNames',{}).values());expr=' '.join(str(p.get(k,''))for k in ['ConditionExpression','UpdateExpression','ProjectionExpression','KeyConditionExpression']);attrs.update(w.strip() for w in p.get('ProjectionExpression','').split(',') if w.strip() and not w.startswith('#'));assert len(p.get('ConditionExpression','').encode())<4096
 for alias in p.get('ExpressionAttributeNames',{}):assert re.search(re.escape(alias)+r'(?![\w])',expr),alias
 for alias in p.get('ExpressionAttributeValues',{}):assert re.search(re.escape(alias)+r'(?![\w])',expr),alias
 if not pk and ':pk' in p.get('ExpressionAttributeValues',{}):pk=p['ExpressionAttributeValues'][':pk']
 context=[{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':sorted(attrs) or ['pk']},{'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':['SPECIFIC_ATTRIBUTES']}]
 if pk:context.append({'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[str(pk)]})
 out=iam.simulate_principal_policy(PolicySourceArn=cfg['Role'],ActionNames=['dynamodb:'+action],ResourceArns=['arn:aws:dynamodb:us-east-1:699561669180:table/'+p['TableName']],ContextEntries=context)['EvaluationResults'][0];results.append({'action':action,'table':p['TableName'],'decision':out['EvalDecision']});assert out['EvalDecision']=='allowed',(kind,p['TableName'],out['EvalDecision'],out.get('MissingContextValues'))
seen=set()
for tx in x['transactions']:
 targets=set()
 for op in tx:
  kind,p=next(iter(op.items()));key=p.get('Key')or {k:p['Item'][k]for k in ['pk','sk']if k in p['Item']};target=p['TableName']+json.dumps(key,sort_keys=True);assert target not in targets;targets.add(target);simulate({'ConditionCheck':'ConditionCheckItem','Put':'PutItem','Update':'UpdateItem'}[kind],p,kind)
for read in x['reads']:
 p=read['input'];fingerprint=json.dumps(read,sort_keys=True)
 if fingerprint in seen:continue
 seen.add(fingerprint);simulate({'Get':'GetItem','Query':'Query','Scan':'Scan'}[read['action']],p,read['action'])
report={'part':251,'status':'PASS','readOnlyLivePreflight':True,'allMutationsInterceptedLocally':True,'currentPayoutUnchanged':True,'localScenario':{'openingIqd':10000,'deliveryIqd':6250,'remainingIqd':3750},'iamChanged':False,'transactionCount':len(x['transactions']),'permissionChecks':results};(r/'docs/cash-accounting-access-251.json').write_text(json.dumps(report,indent=2)+'\n');print('PASS live role permissions and expressions verified:',len(results),'checks; no real writes.',flush=True)
