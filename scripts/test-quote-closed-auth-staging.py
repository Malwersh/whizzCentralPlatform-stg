#!/usr/bin/env python3
"""Verify closed quote/preview integrations using an ephemeral admin-only Cognito client. No messages or application writes."""
import base64, hashlib, hmac, json, secrets, sys, urllib.request, urllib.error
from pathlib import Path
import boto3
assert sys.argv[1:]==['--execute-synthetic-auth']
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1')
assert s.client('sts').get_caller_identity()['Account']=='699561669180'
c=s.client('cognito-idp');pool='us-east-1_TpyyrVkEE';client=None;username=None
report={'scope':'REAL_COGNITO_GATEWAY_CLOSED_QUOTE_PREVIEW','messagesSent':False,'applicationWrites':False,'existingClientsChanged':False,'results':[],'allFixturesRemoved':False}
config=c.describe_user_pool(UserPoolId=pool)['UserPool']
assert config.get('MfaConfiguration','OFF')=='OFF'
assert set(config.get('LambdaConfig',{}))<= {'DefineAuthChallenge','CreateAuthChallenge','VerifyAuthChallengeResponse'},'UNREVIEWED_AUTH_HOOK'
def call(method,path,token):
 req=urllib.request.Request('https://4jut6787c8.execute-api.us-east-1.amazonaws.com/staging'+path,method=method,data=b'{}' if method=='POST' else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return r.status,json.load(r)
 except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
try:
 name='cod29-'+secrets.token_hex(10);phone='+964700'+str(secrets.randbelow(10000000)).zfill(7);password='Aa1!'+secrets.token_hex(24)
 client=c.create_user_pool_client(UserPoolId=pool,ClientName=name,GenerateSecret=True,ExplicitAuthFlows=['ALLOW_ADMIN_USER_PASSWORD_AUTH','ALLOW_REFRESH_TOKEN_AUTH'],PreventUserExistenceErrors='ENABLED',AccessTokenValidity=5,IdTokenValidity=5)['UserPoolClient']
 user=c.admin_create_user(UserPoolId=pool,Username=phone,MessageAction='SUPPRESS',ForceAliasCreation=False,TemporaryPassword=password,UserAttributes=[{'Name':'phone_number','Value':phone},{'Name':'phone_number_verified','Value':'true'},{'Name':'name','Value':name}])['User'];username=user['Username']
 c.admin_set_user_password(UserPoolId=pool,Username=username,Password=password,Permanent=True)
 secret_hash=base64.b64encode(hmac.new(client['ClientSecret'].encode(),(phone+client['ClientId']).encode(),hashlib.sha256).digest()).decode()
 token=c.admin_initiate_auth(UserPoolId=pool,ClientId=client['ClientId'],AuthFlow='ADMIN_USER_PASSWORD_AUTH',AuthParameters={'USERNAME':phone,'PASSWORD':password,'SECRET_HASH':secret_hash})['AuthenticationResult']['AccessToken']
 assert c.get_user(AccessToken=token)['Username']==username
 for method,path,status,code in [('GET','/delivery-quotes',503,'QUOTES_NOT_ENABLED'),('POST','/delivery-quotes',503,'QUOTES_NOT_ENABLED'),('POST','/orders/commercial-preview',409,'COMMERCIAL_NOT_ENABLED')]:
  actual,body=call(method,path,token);assert actual==status and body.get('code')==code,(method,path,actual,body)
  report['results'].append({'method':method,'path':path,'statusCode':actual,'code':code})
 c.admin_disable_user(UserPoolId=pool,Username=username);c.admin_user_global_sign_out(UserPoolId=pool,Username=username)
 try:c.get_user(AccessToken=token);raise RuntimeError('DISABLED_TOKEN_STILL_VALID')
 except c.exceptions.NotAuthorizedException:pass
 report['disabledTokenRejected']=True
finally:
 errors=[]
 if username:
  try:
   c.admin_disable_user(UserPoolId=pool,Username=username);c.admin_user_global_sign_out(UserPoolId=pool,Username=username);c.admin_delete_user(UserPoolId=pool,Username=username)
  except Exception as e:errors.append(type(e).__name__)
 if client:
  try:c.delete_user_pool_client(UserPoolId=pool,ClientId=client['ClientId'])
  except Exception as e:errors.append(type(e).__name__)
 report['allFixturesRemoved']=not errors;report['cleanupErrors']=errors
 Path('/private/tmp/cod29-auth-result.json').write_text(json.dumps(report,indent=2)+'\n')
 if errors:raise RuntimeError('AUTH_FIXTURE_CLEANUP_REQUIRED')
print(json.dumps(report))
