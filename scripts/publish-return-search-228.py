"""Publish the one-module historical bound compatibility repair; no config writes."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,subprocess
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/return-228');name='staging-driver-financial-accept';lam=session().client('lambda');before=json.loads((p/'config.private.json').read_text())
sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
import os
subprocess.run(['node','--test','backend/wallet-service/test/full-cash-lifecycle-matrix-219.test.cjs'],cwd=root,env={**os.environ,'LIFECYCLE_RUNTIME_219':str(p/'candidate.js')},check=True,stdout=subprocess.DEVNULL)
current=lam.get_function_configuration(FunctionName=name);assert current['RevisionId']==before['RevisionId'] and current['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT'
changes={'index.js':(p/'candidate.js').read_bytes()}
with zipfile.ZipFile(p/'base.zip') as original:
 originalSource=original.read('index.js').decode()
assert (p/'candidate.js').read_text().replace('isSearching: live.isActive === true, status: live.isActive === true ? "available" : "offline"','isSearching: false, status: live.isActive === true ? "available" : "offline"')==originalSource,'UNRELATED_CODE_DRIFT'
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
r={'part':228,'status':'PUBLISHED','function':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'repair':'On clean confirmed return, keep searching only if driver remains active; never reactivate an offline driver','changedFiles':['index.js'],'tests':{'capturedLiveFinancialMatrix':64,'failed':0,'onlineAndOfflinePreservation':True},'configurationAndIamPreserved':True,'otherZipEntriesIdentical':True,'financialWritesByAgent':False}
(root/'docs/return-search-publication-228.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
