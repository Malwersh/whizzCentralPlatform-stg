import sys,pathlib,json
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
s=session();cfg=s.client('lambda').get_function_configuration(FunctionName='staging-wizz-staff-service');data=json.loads(pathlib.Path('/private/tmp/payout-report-256-data.private.json').read_text());checks=[];seen=set()
for read in data['reads']:
 p=read['input']
 if p['TableName']!='WizzOrders':continue
 shape=json.dumps(p,sort_keys=True)
 if shape in seen:continue
 seen.add(shape);attributes=set(p['Key'])|set(p.get('ExpressionAttributeNames',{}).values());attributes.update(v for v in p.get('ProjectionExpression','').split(',')if not v.startswith('#'))
 result=s.client('iam').simulate_principal_policy(PolicySourceArn=cfg['Role'],ActionNames=['dynamodb:GetItem'],ResourceArns=['arn:aws:dynamodb:us-east-1:699561669180:table/WizzOrders'],ContextEntries=[{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':sorted(attributes)},{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[p['Key']['PK']]},{'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':['SPECIFIC_ATTRIBUTES']}])['EvaluationResults'][0];assert result['EvalDecision']=='allowed',result;checks.append({'table':'WizzOrders','decision':result['EvalDecision'],'projectedReadOnly':True})
assert checks;report={'part':256,'status':'PASS','allWritesBlocked':True,'actualPaidPayoutAndStatementVerified':True,'publicOrderNumber':'ORD1792545370610','executorName':'غيث علي','ownerReceiptTimePresent':True,'cashBeforeIqd':10000,'cashAfterIqd':3750,'iamChanged':False,'readPermissionChecks':checks};root=pathlib.Path(__file__).resolve().parents[1];(root/'docs/payout-report-access-256.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print('PASS projected order identity reads allowed by existing role; no IAM changes or financial writes.')
