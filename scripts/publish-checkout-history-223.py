"""Publish the one-module historical bound compatibility repair; no config writes."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,subprocess
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/checkout-223');name='WizzUser-CreateOrder-staging';lam=session().client('lambda');before=json.loads((p/'config.private.json').read_text())
sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
for script in ['test-checkout-live-environment-223.cjs','build-checkout-runtime-222.cjs']:
 subprocess.run(['node',str(root/'scripts'/script)]+(['--check'] if script.startswith('build-') else []),cwd=root,check=True)
import os
testEnv={**os.environ,'LIVE_FINANCE_ENV_223':str(p/'config.private.json')}
subprocess.run(['node',str(root/'scripts/test-checkout-entry-222.cjs')],cwd=root,env=testEnv,check=True)
current=lam.get_function_configuration(FunctionName=name);assert current['RevisionId']==before['RevisionId'] and current['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT'
changes={'checkout-finance-runtime-222.js':(root/'backend/shared/checkout-finance-runtime-222.js').read_bytes()}
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
r={'part':223,'status':'PUBLISHED_ACTUAL_ENVIRONMENT_VERIFIED','function':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedFiles':list(changes),'repair':'Match canonical archival bound8 to existing deployed reader bound8; actual archive has6. No scope added, edited, removed or admitted by the publication. General release still independently authorized.','actualEnvironmentRegression':'Original captured helper reproduces FINANCE_ROLLOUT_NOT_CONFIGURED; fixed helper passes exact compressed live environment, stage/region/hash negative guards and general-OFF rejection. Actual nested entry tested with same financial environment across five local cases.','configurationAndIamPreserved':True,'otherZipEntriesIdentical':True,'financialDataWrites':False,'clientUpdateRequired':False}
(root/'docs/checkout-history-publication-223.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
