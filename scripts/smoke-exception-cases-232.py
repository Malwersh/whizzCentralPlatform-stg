"""Read-only permission and unauthenticated boundary checks; tick can write SLA metadata only."""
import sys,pathlib,json,urllib.request,urllib.error
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
s=session();p=pathlib.Path('/private/tmp/exceptions-232');iam=s.client('iam');l=s.client('lambda');out={'permissions':[],'http':[],'callerBoundaries':[]}
for label,action,resource,key in [('staff','lambda:InvokeFunction','arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept',None),('staff','dynamodb:Query','arn:aws:dynamodb:us-east-1:699561669180:table/staging-WalletLifecycle/index/ByDue','ORDER_EXCEPTIONS_OPEN'),('staff','dynamodb:GetItem','arn:aws:dynamodb:us-east-1:699561669180:table/WizzOrders','ORDER#synthetic'),('staff','dynamodb:Query','arn:aws:dynamodb:us-east-1:699561669180:table/staging-Holds','synthetic'),('staff','dynamodb:Query','arn:aws:dynamodb:us-east-1:699561669180:table/WizzOrders/index/GSI_OrderNumber','ORD1792497600000'),('financial','dynamodb:GetItem','arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff','EMPLOYEE#synthetic'),('financial','dynamodb:ConditionCheckItem','arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff','OPERATIONAL_SETTINGS#ORDER_EXCEPTION_CASES'),('financial','cognito-idp:AdminGetUser','arn:aws:cognito-idp:us-east-1:699561669180:userpool/us-east-1_wz7vwZZxz',None)]:
 role=json.loads((p/(label+'-config.private.json')).read_text())['Role'];args={'PolicySourceArn':role,'ActionNames':[action],'ResourceArns':[resource]}
 if key:args['ContextEntries']=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyValues':[key],'ContextKeyType':'stringList'}]
 decision=iam.simulate_principal_policy(**args)['EvaluationResults'][0]['EvalDecision'];assert decision=='allowed',(label,action,decision);out['permissions'].append({'label':label,'action':action,'resource':resource,'allowed':True})
for path in ['/staff/order-exceptions','/staff/settings/order-exception-cases']:
 try:r=urllib.request.urlopen('https://7oum9md7v6.execute-api.us-east-1.amazonaws.com/staging'+path,timeout=30);status=r.status
 except urllib.error.HTTPError as e:status=e.code
 assert status in [401,403];out['http'].append({'path':path,'status':status})
import base64
wrong='x.'+base64.urlsafe_b64encode(json.dumps({'iss':'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TpyyrVkEE','sub':'synthetic','token_use':'access'}).encode()).decode().rstrip('=')+'.x'
for action in ['exception_case_admin','record_merchant_cancellation_retention']:
 body={'orderId':'SYNTHETIC_OFFLINE'} if action=='exception_case_admin' else {'orderId':'SYNTHETIC_OFFLINE','branchId':'synthetic','requestId':'CAN:synthetic','expectedVersion':1,'goodsRetainedByBranch':True,'preparationState':'STARTED','note':'synthetic offline evidence'}
 r=l.invoke(FunctionName='staging-driver-financial-accept',Payload=json.dumps({'action':action,'body':body,'accessToken':wrong}).encode());data=json.loads(r['Payload'].read());assert data['statusCode']==401,(action,data);out['callerBoundaries'].append({'action':action,'wrongPoolStatus':401})
r=l.invoke(FunctionName='staging-order-exception-sla-232',Payload=b'{"action":"tick"}');data=json.loads(r['Payload'].read());assert not r.get('FunctionError'),data;out['monitorTick']=data;out['financialWritesByAgent']=False;(p/'live-smoke.json').write_text(json.dumps(out,indent=2));print('PASS actual scoped access, API auth boundaries, wrong-pool rejection, and metadata-only monitor tick')
