"""User explicitly approved reading the single existing server-routing secret."""
import pathlib,sys,json,time
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=r/'backend/.tmp/order-exceptions-work/return-240';s=session();l=s.client('lambda');iam=s.client('iam');name='staging-driver-financial-accept';current=l.get_function_configuration(FunctionName=name);policy=json.loads((r/'docs/return-routing-240-proposed-iam-policy.json').read_text());st=policy['Statement'];assert len(st)==1 and st[0]['Action']=='secretsmanager:GetSecretValue';arn=st[0]['Resource'];assert arn==json.loads((p/'routing-access-check.json').read_text())['secretArn'];role=current['Role'].split('/')[-1]
iam.put_role_policy(RoleName=role,PolicyName='ReturnRoadRoutingRead240',PolicyDocument=json.dumps(policy));assert iam.get_role_policy(RoleName=role,PolicyName='ReturnRoadRoutingRead240')['PolicyDocument']==policy
env=dict(current['Environment']['Variables']);assert 'FINANCIAL_ROUTING_SECRET_ARN' not in env or env['FINANCIAL_ROUTING_SECRET_ARN']==arn;env['FINANCIAL_ROUTING_SECRET_ARN']=arn
l.update_function_configuration(FunctionName=name,RevisionId=current['RevisionId'],Environment={'Variables':env})
for _ in range(60):
 after=l.get_function_configuration(FunctionName=name)
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==current['CodeSha256'];assert {k:v for k,v in after['Environment']['Variables'].items()if k!='FINANCIAL_ROUTING_SECRET_ARN'}==current['Environment']['Variables']
for k in ['Role','Handler','Runtime','Timeout','MemorySize','Architectures','VpcConfig']:assert current.get(k)==after.get(k)
result=iam.simulate_principal_policy(PolicySourceArn=current['Role'],ActionNames=['secretsmanager:GetSecretValue'],ResourceArns=[arn]);assert all(x['EvalDecision']=='allowed'for x in result['EvaluationResults'])
record={'part':240,'status':'APPLIED','userExplicitApproval':True,'function':name,'policyName':'ReturnRoadRoutingRead240','policy':policy,'addedEnvironmentKey':'FINANCIAL_ROUTING_SECRET_ARN','otherEnvironmentPreserved':True,'codePreserved':True,'secretValueReadByAgent':False,'newFinancialPermissions':False};(r/'docs/return-routing-activation-240.json').write_text(json.dumps(record,indent=2)+'\n');print('PASS approved single-secret read and routing configuration; no secret value displayed or read by agent.')
