import sys,pathlib,json,base64,urllib.request,urllib.error
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
p=pathlib.Path('/private/tmp/disposition-233');l=session().client('lambda');out={'financialWritesByAgent':False,'checks':[]}
def token(pool):return 'x.'+base64.urlsafe_b64encode(json.dumps({'iss':'https://cognito-idp.us-east-1.amazonaws.com/'+pool,'sub':'synthetic','token_use':'access'}).encode()).decode().rstrip('=')+'.x'
body={'orderId':'SYNTHETIC_OFFLINE','branchId':'synthetic','offerId':'offer1','attempt':1,'returnId':'RET:one','expectedVersion':1,'branchCanReceive':True,'note':'synthetic offline assertion'}
r=l.invoke(FunctionName='staging-driver-financial-accept',Payload=json.dumps({'action':'consent_return','body':body,'accessToken':token('us-east-1_TpyyrVkEE')}).encode());data=json.loads(r['Payload'].read());assert data['statusCode']==401,data;out['checks'].append({'action':'consent_return','wrongPoolStatus':401})
r=l.invoke(FunctionName='staging-driver-financial-accept',Payload=json.dumps({'action':'exception_case_admin','body':{'orderId':'SYNTHETIC_OFFLINE'},'accessToken':token('us-east-1_RGTqUXF5C')}).encode());data=json.loads(r['Payload'].read());assert data['statusCode']==401;out['checks'].append({'action':'exception_case_admin','wrongPoolStatus':401})
for name in ['wizzcentral-notifications-staging-pushSendOrderUpdate','wizzcentral-notifications-staging-liveActivityPushUpdate','wizzcentral-notifications-staging-liveActivityPushEnd']:
 # Verify published code hashes only; do not send a real push.
 receipt=json.loads(pathlib.Path('docs/return-disposition-publication-233.json').read_text());expected=next(x for x in receipt['functions']if x['name']==name);assert l.get_function_configuration(FunctionName=name)['CodeSha256']==expected['codeSha256'];out['checks'].append({'function':name,'publishedBytesVerified':True})
(p/'live-smoke.json').write_text(json.dumps(out,indent=2));print('PASS published return-consent auth boundaries and activity-content bytes; no real order or notification mutation')
