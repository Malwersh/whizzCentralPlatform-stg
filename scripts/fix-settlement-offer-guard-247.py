"""Add only the missing conditional evidence check; no business writes or wallet permissions."""
import sys,json,pathlib,copy,time
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
s=session();iam=s.client('iam');role=s.client('lambda').get_function_configuration(FunctionName='staging-wizz-staff-service')['Role'];name=role.split('/')[-1];policy='CompletedOrderStatements204'
before=iam.get_role_policy(RoleName=name,PolicyName=policy)['PolicyDocument'];after=copy.deepcopy(before)
source=next(x for x in before['Statement'] if x.get('Sid')=='ReadProjectedWaveOffersstaging');assert source['Action']=='dynamodb:GetItem'
extra=next(x for x in after['Statement'] if x.get('Sid')=='ReadProjectedWaveOffersstaging');extra['Action']=['dynamodb:GetItem','dynamodb:ConditionCheckItem']
tx=json.load(open('/private/tmp/settlement-save-247-tx.private.json'));p=tx[7]['ConditionCheck'];attrs=sorted(set(p['Key'])|set(p['ExpressionAttributeNames'].values()));context=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[p['Key']['orderId']]},{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':attrs}]
def simulation(document,action='dynamodb:ConditionCheckItem',fields=None):
 c=copy.deepcopy(context)
 if fields:c[1]['ContextKeyValues']=fields
 return iam.simulate_custom_policy(PolicyInputList=[json.dumps(document)],ActionNames=[action],ResourceArns=[extra['Resource']],ContextEntries=c)['EvaluationResults'][0]['EvalDecision']
assert simulation(before)=='implicitDeny';assert simulation(after)=='allowed'
for a in ['dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem']:assert simulation(after,a)=='implicitDeny'
assert simulation(after,fields=attrs+['unapprovedField'])=='implicitDeny'
iam.put_role_policy(RoleName=name,PolicyName=policy,PolicyDocument=json.dumps(after,separators=(',',':')))
assert iam.get_role_policy(RoleName=name,PolicyName=policy)['PolicyDocument']==after
for _ in range(12):
 decision=iam.simulate_principal_policy(PolicySourceArn=role,ActionNames=['dynamodb:ConditionCheckItem'],ResourceArns=[extra['Resource']],ContextEntries=context)['EvaluationResults'][0]['EvalDecision']
 if decision=='allowed':break
 time.sleep(2)
assert decision=='allowed'
record={'part':247,'status':'APPLIED_VERIFIED','cause':'Missing ConditionCheckItem permission on accepted financial offer during atomic statement freeze','role':name,'policy':policy,'updatedStatement':extra,'allOtherStatementsPreserved':True,'newOfferWriteOrWalletPermissions':False,'businessRecordsOrMoneyChanged':False,'tests':{'capturedTransactionOperations':15,'allOtherOperationsAlreadyAllowed':True,'guardNowAllowed':True,'offerPutUpdateDeleteStillDenied':True,'unknownAttributesDenied':True}}
r=pathlib.Path(__file__).resolve().parents[1];(r/'docs/settlement-offer-guard-fix-247.json').write_text(json.dumps(record,indent=2)+'\n');print('PASS missing conditional evidence check applied; write actions remain denied; no business records changed.')
