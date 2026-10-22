"""Scoped metadata-only register permissions; never add wallet/order/ledger authority."""
import sys,json,pathlib
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
s=session();iam=s.client('iam');role=s.client('lambda').get_function_configuration(FunctionName='staging-wizz-staff-service')['Role'];name=role.split('/')[-1];arn='arn:aws:iam::699561669180:policy/staging-merchant-cashbox-register-250'
policy={'Version':'2012-10-17','Statement':[{'Sid':'CashboxDirectoryAndDisbursementRegisterOnly','Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:Query','dynamodb:PutItem','dynamodb:ConditionCheckItem'],'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/staging-MerchantPlatform','Condition':{'Null':{'dynamodb:LeadingKeys':'false'},'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['MERCHANT_CASHBOXES#GLOBAL','MERCHANT_CASHBOX#*']}}}]}
def sim(key,action='dynamodb:PutItem',resource=policy['Statement'][0]['Resource']):return iam.simulate_custom_policy(PolicyInputList=[json.dumps(policy)],ActionNames=[action],ResourceArns=[resource],ContextEntries=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[key]}])['EvaluationResults'][0]['EvalDecision']
for key in ['MERCHANT_CASHBOXES#GLOBAL','MERCHANT_CASHBOX#CASH-BGD-01']:assert sim(key)=='allowed'
for key in ['MERCHANT_PAYOUT#branch','FULL_CASH_JOURNAL#order','OTHER']:assert sim(key)=='implicitDeny'
assert sim('MERCHANT_CASHBOX#CASH-BGD-01','dynamodb:DeleteItem')=='implicitDeny';assert sim('WALLET#PLATFORM',resource='arn:aws:dynamodb:us-east-1:699561669180:table/staging-Wallets')=='implicitDeny'
try:iam.get_policy(PolicyArn=arn)
except iam.exceptions.NoSuchEntityException:iam.create_policy(PolicyName=arn.split('/')[-1],PolicyDocument=json.dumps(policy))
else:
 v=iam.get_policy(PolicyArn=arn)['Policy']['DefaultVersionId'];assert iam.get_policy_version(PolicyArn=arn,VersionId=v)['PolicyVersion']['Document']==policy
attached=iam.list_attached_role_policies(RoleName=name)['AttachedPolicies'];iam.attach_role_policy(RoleName=name,PolicyArn=arn)
assert any(x['PolicyArn']==arn for x in iam.list_attached_role_policies(RoleName=name)['AttachedPolicies'])
r=pathlib.Path(__file__).resolve().parents[1];(r/'docs/cashbox-access-250.json').write_text(json.dumps({'part':250,'status':'APPLIED_VERIFIED','role':name,'policyArn':arn,'policy':policy,'noWalletOrderOrLedgerPermissionsAdded':True,'noBusinessOrMoneyMutation':True,'isolatedPolicyNegativeChecks':'PASS'},indent=2)+'\n');print('PASS metadata-only cashbox access applied; wallet/order/ledger/delete remain outside added policy.')
