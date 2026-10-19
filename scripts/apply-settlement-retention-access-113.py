"""Preview or apply only the reviewed worker retention policy. Never touches app rows."""
import pathlib,json,importlib.util,argparse,hashlib,datetime
ROOT=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance113')
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');args=parser.parse_args()
 spec=importlib.util.spec_from_file_location('capture',ROOT/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);session=m.session();iam=session.client('iam');lam=session.client('lambda')
 reviewed=json.loads((ROOT/'backend/finance-settlement-retention-access.staging.json').read_text());inv=json.loads((O/'inventory.json').read_text())['hosts']['worker'];assert reviewed['targetRole']==inv['role'];assert reviewed['policyName']=='SettlementRetention113'
 policy=reviewed['policyDocument'];assert len(policy['Statement'])==2
 assert policy['Statement'][0]['Action']==['dynamodb:ConditionCheckItem'];assert policy['Statement'][1]['Action']==['dynamodb:GetItem','dynamodb:Query','dynamodb:ConditionCheckItem']
 checks=[('staging-MerchantPlatform','ConditionCheckItem','BRANCH#review-113',True),('staging-MerchantPlatform','ConditionCheckItem','MERCHANT_SETTLEMENT#review-113',True)]
 checks += [('staging-PlatformStaff',a,'SETTLEMENT_SCHEDULE_AUDIT#review-113',True) for a in ['GetItem','Query','ConditionCheckItem']]
 checks += [('staging-PlatformStaff','GetItem','EMPLOYEE#review-113',False),('staging-MerchantPlatform','PutItem','BRANCH#review-113',False),('staging-Wallets','UpdateItem','WALLET#DRIVER#review-113',False),('staging-LedgerEntries','PutItem','WALLET#MERCHANT#review-113',False),('staging-Holds','UpdateItem','review-113',False)]
 results=[]
 for table,action,key,expected in checks:
  value=iam.simulate_custom_policy(PolicyInputList=[json.dumps(policy)],ActionNames=['dynamodb:'+action],ResourceArns=['arn:aws:dynamodb:us-east-1:699561669180:table/'+table],ContextEntries=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[key]}])['EvaluationResults'][0]['EvalDecision'];assert (value=='allowed')==expected
  results.append({'table':table,'action':action,'key':key,'decision':value})
 digest=hashlib.sha256(json.dumps(reviewed,sort_keys=True,separators=(',',':')).encode()).hexdigest();proof={'previewPassed':True,'policySha256':digest,'targetRole':inv['role'],'results':results,'awsMutations':0}
 (O/'permission-preview.json').write_text(json.dumps(proof,indent=2));(O/'permission-preview.json').chmod(0o600)
 if args.execute:
  cfg=lam.get_function_configuration(FunctionName=inv['name']);assert cfg['CodeSha256']==inv['codeSha256'] and cfg['RevisionId']==inv['revisionId'],'LIVE_WORKER_DRIFT';assert cfg['Role']==inv['role']
  role=inv['role'].rsplit('/',1)[1]
  try:old=iam.get_role_policy(RoleName=role,PolicyName=reviewed['policyName'])['PolicyDocument']
  except iam.exceptions.NoSuchEntityException:old=None
  if old is not None:assert old==policy,'EXISTING_POLICY_CONFLICT'
  if old is None:iam.put_role_policy(RoleName=role,PolicyName=reviewed['policyName'],PolicyDocument=json.dumps(policy));proof['awsMutations']=1
  assert iam.get_role_policy(RoleName=role,PolicyName=reviewed['policyName'])['PolicyDocument']==policy
  proof['appliedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(O/'permission-publication.json').write_text(json.dumps(proof,indent=2));(O/'permission-publication.json').chmod(0o600)
 print(json.dumps({'previewPassed':True,'policySha256':digest,'newPolicyCasesPassed':len(results),'applied':args.execute,'awsMutations':proof['awsMutations']}))
if __name__=='__main__':main()
