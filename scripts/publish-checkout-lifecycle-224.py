"""Publish the one-module historical bound compatibility repair; no config writes."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,subprocess
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/checkout-224');name='WizzUser-CreateOrder-staging';lam=session().client('lambda');before=json.loads((p/'config.private.json').read_text())
sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
for script in ['test-checkout-real-data-224.cjs','build-checkout-runtime-222.cjs']:
 subprocess.run(['node',str(root/'scripts'/script)]+(['--check'] if script.startswith('build-') else []),cwd=root,check=True)
import os
testEnv={**os.environ,'LIVE_FINANCE_ENV_223':str(p/'config.private.json'),'CHECKOUT_ENTRY_CANDIDATE_224':str(p/'entry-candidate.js'),'DENY_LIFECYCLE_GET_224':'1'}
subprocess.run(['node',str(root/'scripts/test-checkout-entry-222.cjs')],cwd=root,env=testEnv,check=True)
current=lam.get_function_configuration(FunctionName=name);assert current['RevisionId']==before['RevisionId'] and current['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT'
changes={'_discount_review/user-create-order/index.js':(p/'entry-candidate.js').read_bytes(),'checkout-finance-runtime-222.js':(root/'backend/shared/checkout-finance-runtime-222.js').read_bytes()}
with zipfile.ZipFile(p/'base.zip') as old:
 assert sha((p/'base.zip').read_bytes())==before['CodeSha256']
 with zipfile.ZipFile(p/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
 with zipfile.ZipFile(p/'candidate.zip') as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
raw=(p/'candidate.zip').read_bytes();lam.update_function_code(FunctionName=name,RevisionId=before['RevisionId'],ZipFile=raw,Publish=False)
for _ in range(90):
 after=lam.get_function_configuration(FunctionName=name)
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==sha(raw)
for k in ['Runtime','Handler','Role','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage','Environment']:assert before.get(k)==after.get(k),'CONFIG_DRIFT '+k
r={'part':224,'status':'PUBLISHED_READ_ONLY_REAL_DATA_REHEARSAL_PASSED','function':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedFiles':list(changes),'repair':['Use existing authorized lifecycle ConditionCheck instead of denied GetItem','Use canonical delivery-funded allocation supporting current agreement schema2'],'configurationAndIamPreserved':True,'otherZipEntriesIdentical':True,'financialDataWrites':False,'clientUpdateRequired':False,'verification':{'savedQuoteAndLiveDataPreview':200,'roleSimulatedReads':45,'goodsIqd':7000,'deliveryIqd':1500,'serviceIqd':500,'tipIqd':500,'totalIqd':9500,'identity':'offline only; no real authenticated positive HTTP acceptance claimed','quoteClock':'saved creation time for unmodified saved quote','physicalAcceptance':'pending user retry'}}
(root/'docs/checkout-lifecycle-publication-224.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
