"""Repair actual finance route adapters inside existing bundle; preserve all other source/config."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,urllib.request,subprocess
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/finance-fix-217');name='staging-wizz-staff-service';nested='_discount_review/central-staff/index.js';lam=session().client('lambda');before=json.loads((p/'base.config.private.json').read_text());current=lam.get_function_configuration(FunctionName=name);assert current['RevisionId']==before['RevisionId'] and current['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT'
subprocess.run(['node',str(root/'scripts/test-finance-entry-217.cjs')],cwd=root,check=True)
changes={nested:(p/'entry-candidate.js').read_bytes()};sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
with zipfile.ZipFile(p/'base.zip') as old:
 assert sha((p/'base.zip').read_bytes())==before['CodeSha256']
 assert old.read('index.js').decode().strip().endswith('module.exports = require("./_discount_review/central-staff/index.js");')
 for n in ['settlement-schedules.js','settlement-runtime.js','commercial-owner.js','merchant-payouts.js','merchant-account.js','settlement-orders.js','settlement-evidence-fields.json']:
  assert old.read(n)==(root/'backend/staff-service'/n).read_bytes(),'ROOT_ADAPTER_DRIFT '+n
 with zipfile.ZipFile(p/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
 with zipfile.ZipFile(p/'candidate.zip') as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
raw=(p/'candidate.zip').read_bytes();lam.update_function_code(FunctionName=name,RevisionId=before['RevisionId'],ZipFile=raw,Publish=False)
for _ in range(90):
 after=lam.get_function_configuration(FunctionName=name)
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==sha(raw)
for key in ['Runtime','Handler','Role','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage','Environment']:assert after.get(key)==before.get(key),'CONFIG_DRIFT '+key
for event in [{'httpMethod':'GET','path':'/staff/settlement-schedules','queryStringParameters':{'view':'orders','branchId':'invalid'},'headers':{}},{'action':'settlement_schedule_owner','httpMethod':'GET','input':{'view':'merchant-account','branchId':'invalid'},'accessToken':'INVALID_NEGATIVE_SMOKE'}]:
 response=lam.invoke(FunctionName=name,Payload=json.dumps(event).encode());v=json.loads(response['Payload'].read());assert not response.get('FunctionError') and v.get('statusCode')==401,v
receipt={'part':217,'status':'PUBLISHED_ACTUAL_ENTRY_VERIFIED','function':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedEntries':[nested],'actualEntry':'index.js -> '+nested,'repair':'Bundled staff settlement module delegates to current root service; owner settlement action delegates to verified owner adapter; unrelated commercial action remains original','otherFilesPreserved':True,'configurationAndPermissionsPreserved':True,'offlineActualEntryRegression':'Old403 reproduced with non-v4 Cognito ID; staff and merchant read paths200 after fix; invalid auth401; no writes','negativeLiveAuthSmokes':2,'financialDataChanged':False,'humanPermissionsChanged':False}
(root/'docs/finance-entry-publication-217.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
