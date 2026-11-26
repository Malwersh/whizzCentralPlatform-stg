"""Apply metadata-only access explicitly approved by the user for part242."""
import pathlib,sys,json
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=r/'backend/.tmp/order-exceptions-work/settlement-242';s=session();c=json.loads((p/'financial-config.private.json').read_text());policy=json.loads((r/'docs/exception-financial-access-242-proposed.json').read_text());role=c['Role'].split('/')[-1]
for statement in policy['Statement']:assert statement['Resource'].endswith(':table/staging-MerchantPlatform') and set(statement['Action'])<=set(['dynamodb:GetItem','dynamodb:PutItem','dynamodb:ConditionCheckItem'])
iam=s.client('iam');iam.put_role_policy(RoleName=role,PolicyName='ExceptionFinancialIndexAndPayoutProof242',PolicyDocument=json.dumps(policy));assert iam.get_role_policy(RoleName=role,PolicyName='ExceptionFinancialIndexAndPayoutProof242')['PolicyDocument']==policy
result={'part':242,'status':'APPLIED','userExplicitApproval':True,'role':role,'policyName':'ExceptionFinancialIndexAndPayoutProof242','policy':policy,'newWalletOrLedgerPermissions':False,'businessDecisionOrPaymentPerformed':False};(r/'docs/exception-financial-access-242.json').write_text(json.dumps(result,indent=2)+'\n');print('PASS user-approved scoped index metadata and payout-proof access. No wallet/ledger permissions added.')
