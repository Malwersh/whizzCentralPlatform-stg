"""Apply user-approved, metadata-only access; seed approved operational defaults."""
import pathlib,sys,json,time
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=r/'backend/.tmp/order-exceptions-work/return-240';s=session();iam=s.client('iam')
c=json.loads((p/'financial-config.private.json').read_text());role=c['Role'].split('/')[-1];policy=json.loads((r/'docs/return-operations-240-proposed-iam-policy.json').read_text())
assert len(policy['Statement'])==2
for st in policy['Statement']:assert set(st['Action'])<=set(['dynamodb:GetItem','dynamodb:PutItem','dynamodb:ConditionCheckItem']) and 'LeadingKeys' in json.dumps(st['Condition'])
iam.put_role_policy(RoleName=role,PolicyName='ReturnOperationsMetadata240',PolicyDocument=json.dumps(policy))
assert iam.get_role_policy(RoleName=role,PolicyName='ReturnOperationsMetadata240')['PolicyDocument']==policy
at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());table=s.resource('dynamodb').Table('staging-PlatformStaff');key={'pk':'OPERATIONAL_SETTINGS#RETURN_OPERATIONS','sk':'CURRENT'}
row={**key,'version':1,'policyVersion':'RETURN_OPERATIONS_240_USER_APPROVED_V1','values':{'enabled':True,'closingMarginSeconds':900,'branchWaitSeconds':300},'updatedAt':at,'approvalSource':'USER_EXPLICIT_POLICY_AND_METADATA_IAM_APPROVAL','part':240}
prior=table.get_item(Key=key,ConsistentRead=True).get('Item')
if not prior:table.put_item(Item=row,ConditionExpression='attribute_not_exists(pk)')
else:assert prior['values']==row['values'],'EXISTING_POLICY_DIFFERS'
record={'part':240,'status':'APPLIED','role':role,'policyName':'ReturnOperationsMetadata240','policy':policy,'values':row['values'],'timestamp':at,'userExplicitApproval':True,'newFinancialPermissions':False}
(r/'docs/return-operations-access-240.json').write_text(json.dumps(record,indent=2)+'\n');print('PASS approved metadata-only IAM policy and operational defaults. No owner consent or financial data written.')
