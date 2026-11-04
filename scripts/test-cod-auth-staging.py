#!/usr/bin/env python3
"""Ephemeral admin-only Cognito clients/users, no SMS/email, no application client changes and no financial/DynamoDB writes."""
import boto3,json,sys,secrets,hmac,hashlib,base64,subprocess,os,urllib.request,urllib.error
from pathlib import Path
assert sys.argv[1:]==['--execute-synthetic-auth']
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';c=s.client('cognito-idp');report={'scope':'REAL_COGNITO_AND_GATEWAY_CLOSED_GATES','smsSent':False,'humanDataAccess':False,'existingAppClientsChanged':False,'results':[],'allFixturesRemoved':False};created=[]
node="""const fs=require('fs'),v=JSON.parse(fs.readFileSync(0,'utf8')),r=require('node:module').createRequire(require.resolve('./backend/wallet-service/dist/financialIdentity')), {CognitoIdentityProviderClient}=r('@aws-sdk/client-cognito-identity-provider'),{authenticateFinancialIdentity}=require('./backend/wallet-service/dist/financialIdentity');authenticateFinancialIdentity(new CognitoIdentityProviderClient({region:'us-east-1'}),v.token,v.kind).then(x=>process.stdout.write(JSON.stringify(x))).catch(e=>{process.stderr.write(e.code||e.message);process.exitCode=1;});"""
def request(url,token,body):
 req=urllib.request.Request(url,data=json.dumps(body).encode(),method='POST',headers={'Content-Type':'application/json','Authorization':'Bearer '+token})
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return r.status,json.loads(r.read())
 except urllib.error.HTTPError as e:
  data=e.read();return e.code,json.loads(data) if data else {}
try:
 for kind,pool in [('DRIVER','us-east-1_RGTqUXF5C'),('MERCHANT_OWNER','us-east-1_gtCR3ndzT')]:
  assert c.describe_user_pool(UserPoolId=pool)['UserPool'].get('MfaConfiguration','OFF')!='ON','REQUIRED_MFA_WOULD_SEND_A_MESSAGE'
  name='cod26-'+secrets.token_hex(10);phone='+964700'+str(secrets.randbelow(10000000)).zfill(7);password='Aa1!'+secrets.token_hex(24)
  app=c.create_user_pool_client(UserPoolId=pool,ClientName=name,GenerateSecret=True,ExplicitAuthFlows=['ALLOW_ADMIN_USER_PASSWORD_AUTH','ALLOW_REFRESH_TOKEN_AUTH'],PreventUserExistenceErrors='ENABLED',AccessTokenValidity=5,IdTokenValidity=5)['UserPoolClient'];fixture={'pool':pool,'client':app['ClientId'],'user':None};created.append(fixture)
  # No ForceAliasCreation: never migrate an alias if it already belongs to another identity.
  user=c.admin_create_user(UserPoolId=pool,Username=phone,MessageAction='SUPPRESS',ForceAliasCreation=False,TemporaryPassword=password,UserAttributes=[{'Name':'phone_number','Value':phone},{'Name':'phone_number_verified','Value':'true'},{'Name':'name','Value':name}])['User'];fixture['user']=user['Username'];sub=next(a['Value'] for a in user['Attributes'] if a['Name']=='sub');c.admin_set_user_password(UserPoolId=pool,Username=user['Username'],Password=password,Permanent=True)
  assert not c.admin_get_user(UserPoolId=pool,Username=user['Username']).get('UserMFASettingList'),'USER_MFA_WOULD_SEND_A_MESSAGE'
  secret_hash=base64.b64encode(hmac.new(app['ClientSecret'].encode(),(phone+app['ClientId']).encode(),hashlib.sha256).digest()).decode()
  result=c.admin_initiate_auth(UserPoolId=pool,ClientId=app['ClientId'],AuthFlow='ADMIN_USER_PASSWORD_AUTH',AuthParameters={'USERNAME':phone,'PASSWORD':password,'SECRET_HASH':secret_hash})['AuthenticationResult'];token=result['AccessToken'];assert c.get_user(AccessToken=token)['Username']==user['Username']
  env={**os.environ,'AWS_PROFILE':'Wizz_stg_UserApp','AWS_REGION':'us-east-1'};identity=subprocess.run(['node','-e',node],input=json.dumps({'token':token,'kind':kind}),text=True,capture_output=True,env=env,check=True);assert json.loads(identity.stdout)=={'kind':kind,'subjectId':sub}
  if kind=='DRIVER':
   status,body=request('https://6ogrj6so22.execute-api.us-east-1.amazonaws.com/staging/driver/accept-wave-offer',token,{'offerId':'FINO:'+name,'orderId':name,'waveNumber':1});assert status==409 and body.get('code')=='FINANCIAL_DISPATCH_DISABLED',(status,body);checked='AUTHENTICATED_GATEWAY_FINANCIAL_GATE_CLOSED'
  else:
   # The application route must reject this administrator-only test client; existing app client binding is preserved.
   status,body=request('https://ie7z8r4wc0.execute-api.us-east-1.amazonaws.com/staging/auth/order-returns',token,{});assert status==401,(status,body);checked='NON_APPLICATION_CLIENT_REJECTED'
  c.admin_disable_user(UserPoolId=pool,Username=user['Username']);c.admin_user_global_sign_out(UserPoolId=pool,Username=user['Username'])
  try:c.get_user(AccessToken=token);raise RuntimeError('DISABLED_TOKEN_STILL_VALID')
  except c.exceptions.NotAuthorizedException:pass
  report['results'].append({'kind':kind,'liveFinancialIdentityVerified':True,'gatewayResult':checked,'disabledTokenRejected':True});print(json.dumps(report['results'][-1]),flush=True)
finally:
 errors=[]
 for f in reversed(created):
  if f['user']:
   try:c.admin_disable_user(UserPoolId=f['pool'],Username=f['user']);c.admin_user_global_sign_out(UserPoolId=f['pool'],Username=f['user']);c.admin_delete_user(UserPoolId=f['pool'],Username=f['user'])
   except Exception as e:errors.append(type(e).__name__)
  try:c.delete_user_pool_client(UserPoolId=f['pool'],ClientId=f['client'])
  except Exception as e:errors.append(type(e).__name__)
 report['allFixturesRemoved']=not errors;report['cleanupErrors']=errors;Path('/private/tmp/cod26-auth-result.json').write_text(json.dumps(report,indent=2)+'\n')
 if errors:raise RuntimeError('AUTH_FIXTURE_CLEANUP_REQUIRED')
