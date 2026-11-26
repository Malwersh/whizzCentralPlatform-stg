"""Repair the actual nested checkout entry; preserve host discount features and config."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,subprocess,urllib.request,os
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/cart-222');name='WizzUser-CreateOrder-staging';nested='_discount_review/user-create-order/index.js';lam=session().client('lambda');before=json.loads((p/'base.config.private.json').read_text())
previous=json.loads((root/'docs/checkout-entry-publication-222.json').read_text()) if (root/'docs/checkout-entry-publication-222.json').exists() else None
if '--runtime-only' in sys.argv:
 assert previous and previous['status']=='PUBLISHED_ACTUAL_ENTRY_VERIFIED'
 full=lam.get_function(FunctionName=name);before=full['Configuration'];assert before['CodeSha256']==previous['codeSha256'],'LIVE_DRIFT'
 p=p/'self-contained';p.mkdir(exist_ok=True);(p/'base.config.private.json').write_text(json.dumps(before,default=str));(p/'base.zip').write_bytes(urllib.request.urlopen(full['Code']['Location'],timeout=60).read());(p/'entry-candidate.js').write_bytes(pathlib.Path('/private/tmp/cart-222/entry-candidate.js').read_bytes())
current=lam.get_function_configuration(FunctionName=name);assert current['RevisionId']==before['RevisionId'] and current['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT'
subprocess.run(['node',str(root/'scripts/test-checkout-entry-222.cjs')],cwd=root,env={**os.environ,'LIVE_FINANCE_ENV_223':str(p/'base.config.private.json')},check=True)
sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
changes={nested:(p/'entry-candidate.js').read_bytes(),'checkout-finance-runtime-222.js':(root/'backend/shared/checkout-finance-runtime-222.js').read_bytes()}
with zipfile.ZipFile(p/'base.zip') as old:
 assert sha((p/'base.zip').read_bytes())==before['CodeSha256']
 assert 'require("../../_discount_review/user-create-order/index.js")' in old.read('functions/create-order/index.js').decode()
 with zipfile.ZipFile(p/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  for n,b in changes.items():
   if n not in old.namelist():out.writestr(n,b)
 with zipfile.ZipFile(p/'candidate.zip') as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
raw=(p/'candidate.zip').read_bytes();latest=lam.get_function_configuration(FunctionName=name);assert latest['RevisionId']==before['RevisionId'];lam.update_function_code(FunctionName=name,RevisionId=before['RevisionId'],ZipFile=raw,Publish=False)
for _ in range(90):
 after=lam.get_function_configuration(FunctionName=name)
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==sha(raw)
for k in ['Runtime','Handler','Role','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage','Environment']:assert before.get(k)==after.get(k),'CONFIG_DRIFT '+k
negative=lam.invoke(FunctionName=name,Payload=json.dumps({'httpMethod':'POST','resource':'/orders/commercial-preview','headers':{},'body':json.dumps({'action':'preview_commercial','userId':'invalid','storeId':'invalid','storeName':'negative-auth','storeAddress':'negative-auth','deliveryAddress':{'id':'invalid'},'paymentMethod':'cod','items':[{'id':'invalid','quantity':1}]})}).encode());r=json.loads(negative['Payload'].read());assert not negative.get('FunctionError') and r.get('statusCode')==401,r
receipt={'part':222,'status':'PUBLISHED_ACTUAL_ENTRY_VERIFIED','function':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedFiles':list(changes),'otherFilesPreserved':True,'actualEntry':'functions/create-order/index.js -> '+nested,'configurationAndPermissionsPreserved':True,'repair':'Canonical general finance admission, full-cash quote commit and promotion selection; surgical full-cash funding integration into existing commercial builder preserves current discount/benefit receipts and line pricing','offlineActualEntry':'Old403 reproduced; fresh general preview read-only; tip/no-tip, merchant/platform delivery funding commit snapshot3, no platform cash reservation, replay no repeated financial mutation, missing auth401','negativeLiveAuthSmoke':401,'financialDataWrites':False,'newTestScopesAdded':False,'helperSdkDependencies':'SELF_CONTAINED','previousVerifiedPublication':previous.get('codeSha256') if previous else None}
(root/'docs/checkout-entry-publication-222.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
