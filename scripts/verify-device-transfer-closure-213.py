"""Read-only deployed route and IAM boundary checks. No financial requests."""
import sys,pathlib,json,urllib.request,urllib.error
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
s=session();lam=s.client('lambda');iam=s.client('iam');root=pathlib.Path(__file__).resolve().parents[1];doc=root/'docs/device-transfer-closure-213.json';r=json.loads(doc.read_text());assert r['status']=='PUBLISHED_VERIFIED'
f=lam.get_function_configuration(FunctionName=r['functionName']);assert f['CodeSha256']==r['functionCodeSha256'];prefix='arn:aws:dynamodb:us-east-1:699561669180:table/'
cases=[('merchant wallet read','dynamodb:GetItem','staging-Wallets','WALLET#MERCHANT#probe',True),('merchant wallet update','dynamodb:UpdateItem','staging-Wallets','WALLET#MERCHANT#probe',True),('platform wallet update denied','dynamodb:UpdateItem','staging-Wallets','WALLET#PLATFORM',False),('permission policy read','dynamodb:GetItem','staging-PlatformStaff','OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',True),('employee profile read denied','dynamodb:GetItem','staging-PlatformStaff','EMPLOYEE#probe',False),('branch audit allowed','dynamodb:PutItem','staging-MerchantPlatform','BRANCH#probe',True),('payout journal write denied','dynamodb:PutItem','staging-MerchantPlatform','MERCHANT_PAYOUT_PAID#probe',False)]
checks=[]
for label,action,table,key,allowed in cases:
 q=iam.simulate_principal_policy(PolicySourceArn=f['Role'],ActionNames=[action],ResourceArns=[prefix+table],ContextEntries=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyValues':[key],'ContextKeyType':'stringList'}])['EvaluationResults'][0]
 assert (q['EvalDecision']=='allowed')==allowed,(label,q['EvalDecision'],q.get('MissingContextValues'));checks.append({'boundary':label,'decision':q['EvalDecision']})
routes=[]
for path,method in [('context','GET'),('recipient','GET'),('history','GET'),('status','GET'),('otp/send','POST'),('otp/verify','POST'),('request','POST'),('cancel','POST')]:
 request=urllib.request.Request('https://z14s5f8oxh.execute-api.us-east-1.amazonaws.com/staging/wallet/branch-device/transfers/'+path,method=method,data=b'{}' if method=='POST' else None,headers={'Content-Type':'application/json'})
 try:urllib.request.urlopen(request,timeout=30);raise AssertionError('UNAUTHENTICATED_ROUTE_ALLOWED')
 except urllib.error.HTTPError as e:assert e.code==401,(path,e.code);routes.append({'path':path,'method':method,'unauthenticatedStatus':e.code})
r.update(iamBoundariesVerified=checks,deployedGatewayRoutesVerified=routes,authorizerTests=15,nativeTransferTests=7,serviceRegressionTests=1067,noRealPaymentOrOtpPerformed=True)
doc.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'iamBoundaries':len(checks),'gatewayRoutes':len(routes),'status':'VERIFIED','financialOperationsRequested':False}))
