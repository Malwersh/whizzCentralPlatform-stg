"""Read-only IAM simulation against captured Staging roles. No app data reads."""
import pathlib,json,importlib.util,datetime
ROOT=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance113')
def main():
 spec=importlib.util.spec_from_file_location('capture',ROOT/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);s=m.session();iam=s.client('iam');inv=json.loads((O/'inventory.json').read_text())['hosts'];results=[]
 cases=[]
 def add(host,table,actions,key,attrs=None):
  for action in actions:cases.append((host,table,action,key,attrs))
 add('staff','staging-PlatformStaff',['GetItem','ConditionCheckItem'],'EMPLOYEE#11111111-1111-4111-8111-111111111111')
 add('staff','staging-PlatformStaff',['PutItem'],'SETTLEMENT_SCHEDULE_AUDIT#review-113')
 add('staff','staging-MerchantPlatform',['GetItem','Query','PutItem','ConditionCheckItem'],'BRANCH#review-113')
 add('staff','staging-MerchantPlatform',['GetItem','ConditionCheckItem'],'COMMERCIAL_AGREEMENT#review-113')
 add('staff','WhizzMerchants_Businesses',['GetItem','ConditionCheckItem'],'review-113')
 add('staff','WhizzMerchants_Businesses',['Scan'],'review-113',['businessId','businessName','name','status','deletionRequestId','deletedAt','isDeleted'])
 for key in ['BUSINESS_LIFECYCLE#MERCHANT#review-113','ACCOUNT_LIFECYCLE#MERCHANT#review-113']:
  add('staff','staging-AccountDeletion',['GetItem'],key,['pk','sk']);add('staff','staging-AccountDeletion',['ConditionCheckItem'],key)
 for key in ['BRANCH#review-113','MERCHANT_SETTLEMENT#review-113']:add('worker','staging-MerchantPlatform',['GetItem','Query','ConditionCheckItem'],key)
 add('worker','staging-PlatformStaff',['GetItem','Query','ConditionCheckItem'],'SETTLEMENT_SCHEDULE_AUDIT#review-113')
 add('worker','staging-AccountDeletionFinancialArchive',['GetItem','PutItem','ConditionCheckItem'],'REQUEST#11111111-1111-4111-8111-111111111111')
 add('worker','WhizzMerchants_Businesses',['GetItem','ConditionCheckItem'],'review-113')
 add('worker','staging-AccountDeletion',['GetItem','ConditionCheckItem'],'BUSINESS_LIFECYCLE#MERCHANT#review-113')
 for host,table,action,key,attrs in cases:
  context=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[key]}]
  if attrs:context.extend([{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':attrs},{'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':['SPECIFIC_ATTRIBUTES']}])
  out=iam.simulate_principal_policy(PolicySourceArn=inv[host]['role'],ActionNames=['dynamodb:'+action],ResourceArns=['arn:aws:dynamodb:us-east-1:699561669180:table/'+table],ContextEntries=context)['EvaluationResults'][0]
  results.append({'host':host,'table':table,'action':action,'keyPatternExample':key,'attributes':attrs,'decision':out['EvalDecision'],'missingContext':out.get('MissingContextValues',[])})
 doc={'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':results,'awsMutations':0};(O/'iam-simulation.json').write_text(json.dumps(doc,indent=2));(O/'iam-simulation.json').chmod(0o600)
 print(json.dumps({'cases':len(results),'denied':[r for r in results if r['decision']!='allowed'],'awsMutations':0}))
if __name__=='__main__':main()
