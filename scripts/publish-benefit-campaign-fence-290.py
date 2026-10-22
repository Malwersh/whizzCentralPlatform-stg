import sys,json,pathlib,hashlib,time
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];out=pathlib.Path('/private/tmp/benefit-confirmation-290');iam=session().client('iam');role='WizzUser-backend-staging-CreateOrderFunctionRole-XxtsdKKNLkNN';name='PlatformBenefitEntitlements20261020';arn='arn:aws:iam::699561669180:role/'+role;resource='arn:aws:dynamodb:us-east-1:699561669180:table/WizzCentral_Platform_Discounts'
base=json.loads((out/'policies.json').read_text())[name];current=iam.get_role_policy(RoleName=role,PolicyName=name)['PolicyDocument'];assert current==base,'Concurrent policy change';candidate=json.loads(json.dumps(base));candidate['Statement'].append({'Sid':'PlatformBenefitCampaignFence','Effect':'Allow','Action':['dynamodb:ConditionCheckItem'],'Resource':resource});(out/'candidate-policy.json').write_text(json.dumps(candidate,indent=2));
checks=[]
def simulate(doc):
 result=iam.simulate_custom_policy(PolicyInputList=[json.dumps(doc)],ActionNames=['dynamodb:ConditionCheckItem','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem'],ResourceArns=[resource,'arn:aws:dynamodb:us-east-1:699561669180:table/WhizzMerchants_Businesses'])['EvaluationResults'];return {(v['EvalResourceName'],r['EvalActionName']):v['EvalResourceDecision'] for r in result for v in r.get('ResourceSpecificResults',[{'EvalResourceName':r['EvalResourceName'],'EvalResourceDecision':r['EvalDecision']}])}
before,after=simulate(base),simulate(candidate)
for key in before:
 expected='allowed' if key==(resource,'dynamodb:ConditionCheckItem') else before[key]
 assert after[key]==expected,(key,before[key],after[key]);checks.append({'resource':key[0],'action':key[1],'before':before[key],'after':after[key]})
assert before[(resource,'dynamodb:ConditionCheckItem')]=='implicitDeny'
assert iam.get_role_policy(RoleName=role,PolicyName=name)['PolicyDocument']==base
# Adds only a read-only campaign fence; does not submit an order or grant a benefit.
iam.put_role_policy(RoleName=role,PolicyName=name,PolicyDocument=json.dumps(candidate))
assert iam.get_role_policy(RoleName=role,PolicyName=name)['PolicyDocument']==candidate
live=None
for attempt in range(12):
 live=iam.simulate_principal_policy(PolicySourceArn=arn,ActionNames=['dynamodb:ConditionCheckItem'],ResourceArns=[resource],ContextEntries=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':['f688fc65-9f68-4b57-8756-31722a4a38d4']}])['EvaluationResults'][0]['EvalDecision']
 if live=='allowed':break
 time.sleep(2)
assert live=='allowed',live
record={'part':290,'status':'PUBLISHED_PERMISSION_VERIFIED_HUMAN_RETRY_PENDING','rootCause':'Missing dynamodb:ConditionCheckItem on the platform campaign table while committing a benefit-backed order','role':role,'inlinePolicy':name,'addedAction':'dynamodb:ConditionCheckItem','resource':resource,'lambdaCodeChanged':False,'hostingChanged':False,'applicationDataWritten':False,'orderSubmittedByAgent':False,'beforePolicySha256':hashlib.sha256(json.dumps(base,sort_keys=True).encode()).hexdigest(),'afterPolicySha256':hashlib.sha256(json.dumps(candidate,sort_keys=True).encode()).hexdigest(),'policySimulation':checks,'liveDecision':live,'observedFailedAttempt':{'lambdaRequestId':'3145c38a-dce0-4307-8e5f-06757b923bfa','timeUtc':'2026-10-22T19:27:57Z','code':'QUOTE_ORDER_UNAVAILABLE','internalCause':'AccessDeniedException','newCustomerOrders':0,'both500Benefits':{'reservedUses':0,'usedUses':0}}}
(root/'docs/platform-benefit-confirmation-permission-290.json').write_text(json.dumps(record,indent=2)+'\n');print('PASS: one existing role policy updated; campaign condition-check allowed; campaign writes and other-table permissions unchanged.')
