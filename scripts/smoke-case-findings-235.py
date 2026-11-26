import sys,pathlib,json,base64
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
p=pathlib.Path('/private/tmp/findings-235');l=session().client('lambda');r={'financialWritesByAgent':False,'checks':[]}
wrong='x.'+base64.urlsafe_b64encode(json.dumps({'iss':'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TpyyrVkEE','sub':'synthetic','token_use':'access'}).encode()).decode().rstrip('=')+'.x'
body={'orderId':'SYNTHETIC_OFFLINE','branchId':'synthetic','reason':'synthetic boundary test','preparationState':'NOT_STARTED','goodsRetainedByBranch':True,'cashCollected':False,'idempotencyKey':'12345678-1234-4123-8123-123456789abc'}
x=l.invoke(FunctionName='staging-driver-financial-accept',Payload=json.dumps({'action':'exception_case_admin','body':body,'accessToken':wrong}).encode());data=json.loads(x['Payload'].read());assert data['statusCode']==401,data;r['checks'].append({'action':'exception_case_admin','wrongPoolStatus':401})
receipt=json.loads(pathlib.Path('docs/case-findings-publication-235.json').read_text())
for f in receipt['functions']:
 assert l.get_function_configuration(FunctionName=f['name'])['CodeSha256']==f['codeSha256'];r['checks'].append({'function':f['name'],'publishedBytesVerified':True})
x=l.invoke(FunctionName='staging-order-exception-sla-232',Payload=b'{"action":"tick"}');data=json.loads(x['Payload'].read());assert not x.get('FunctionError'),data;r['monitorTick']=data;(p/'live-smoke.json').write_text(json.dumps(r,indent=2));print('PASS live merchant auth boundary, published function hashes and metadata-only monitor')
