"""Read-only scoped administration/identity readiness; no tokens, secrets or person profile export."""
import json,pathlib,importlib.util,concurrent.futures
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path('/private/tmp/finance64')
sp=importlib.util.spec_from_file_location('capture63',ROOT/'scripts/capture-financial-readers-63.py');c=importlib.util.module_from_spec(sp);sp.loader.exec_module(c)
def main():
 s=c.session();iam=s.client('iam');staff=json.loads((OUT/'staff.latest.config.private.json').read_text());merchant=json.loads((OUT/'merchant.config.private.json').read_text());rows=[]
 for table,key,actions in [('staging-MerchantPlatform','COMMERCIAL_AGREEMENT#sample64',['GetItem','PutItem','ConditionCheckItem']),('staging-MerchantPlatform','BRANCH#sample64',['GetItem','PutItem','Query','ConditionCheckItem']),('staging-MerchantPlatform','PERSON#sample64',['GetItem','ConditionCheckItem']),('staging-PlatformStaff','DISCOUNT_FUNDING#sample64',['GetItem','PutItem','ConditionCheckItem']),('staging-PlatformStaff','COMMERCIAL_AGREEMENT#sample64',['PutItem','GetItem','ConditionCheckItem']),('WhizzMerchants_Businesses','sample64',['GetItem','UpdateItem','ConditionCheckItem']),('staging-AccountDeletion','BUSINESS_LIFECYCLE#MERCHANT#sample64',['ConditionCheckItem'])]:
  for a in actions:rows.append(('staff','dynamodb:'+a,'arn:aws:dynamodb:us-east-1:699561669180:table/'+table,key))
 rows.append(('merchant','lambda:InvokeFunction','arn:aws:lambda:us-east-1:699561669180:function:'+staff['FunctionName'],None))
 def check(row):
  host,action,resource,key=row;args={'PolicySourceArn':{'staff':staff,'merchant':merchant}[host]['Role'],'ActionNames':[action],'ResourceArns':[resource]}
  if key:args['ContextEntries']=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[key]}]
  decision=iam.simulate_principal_policy(**args)['EvaluationResults'][0]['EvalDecision'];return {'host':host,'action':action,'resource':resource,'leadingKey':key,'decision':decision}
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:checks=list(pool.map(check,rows))
 known=json.loads((OUT/'selected-staff.private.json').read_text());cognito=s.client('cognito-idp');pool=staff['Environment']['Variables']['USER_POOL_ID'];identity=[]
 for actor in known:
  row=cognito.admin_get_user(UserPoolId=pool,Username=actor['employeeId']);attrs={a['Name']:a['Value'] for a in row['UserAttributes']};assert attrs['sub']==actor['employeeId'];identity.append({'email':actor['email'],'enabled':row['Enabled'],'confirmed':row['UserStatus']=='CONFIRMED','totpEnrolled':'SOFTWARE_TOKEN_MFA' in row.get('UserMFASettingList',[])})
 report={'part':64,'readOnly':True,'checks':checks,'identity':identity,'mutationsPerformedByAudit':False};(OUT/'access-audit.json').write_text(json.dumps(report,indent=2));print(json.dumps({'checks':len(checks),'allowed':sum(x['decision']=='allowed' for x in checks),'blocked':[x for x in checks if x['decision']!='allowed'],'staffIdentityReadiness':identity}))
if __name__=='__main__':main()
