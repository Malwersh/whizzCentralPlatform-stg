"""Publish the one-module historical bound compatibility repair; no config writes."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,subprocess
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/return-225');name='staging-driver-financial-accept';lam=session().client('lambda');before=json.loads((p/'config.private.json').read_text())
sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
subprocess.run(['node',str(root/'scripts/test-general-return-225.cjs')],cwd=root,check=True)
assert all(x['decision']=='allowed' for x in json.loads((p/'transaction-role-review.json').read_text()))
current=lam.get_function_configuration(FunctionName=name);assert current['RevisionId']==before['RevisionId'] and current['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT'
changes={'index.js':(p/'candidate.js').read_bytes()}
expected=(p/'base/index.js').read_text()
for anchor in ['const { db, cognito, rollout } = clients(), owner = ["read_return", "confirm_return"].includes(action);','const { db, cognito, rollout } = clients(), owner = action === "cancel_before_pickup";']:
 assert expected.count(anchor)==1
 expected=expected.replace(anchor,anchor+'\n  await rollout.order(body.orderId, "DRAIN");')
assert (p/'candidate.js').read_text()==expected,'UNRELATED_CODE_DRIFT'

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
r={'part':225,'status':'PUBLISHED_DEVICE_ACCEPTANCE_PENDING','function':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedFiles':list(changes),'repair':'Initialize existing order rollout DRAIN before return/reassignment identity membership check; all authentication and financial checks preserved','configurationAndIamPreserved':True,'otherZipEntriesIdentical':True,'financialDataWrites':False,'clientUpdateRequired':False,'verification':{'capturedOldRuntime':'reproduced FINANCE_ROLLOUT_OUT_OF_SCOPE for actual new general order','candidate':'builds return transaction using live data; transaction intercepted locally, no real mutation','roleSimulation':'all proposed transaction operations allowed','positiveAuthenticatedApiAcceptance':'pending user retry'}}
(root/'docs/general-return-publication-225.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
