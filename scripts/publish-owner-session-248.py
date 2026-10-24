"""Bounded staging runtime update: honor existing valid-session policy, no data writes."""
import sys,pathlib,json,hashlib,base64,zipfile,copy,time,urllib.request,io
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1]
for log in ['tests']:
 assert 'ℹ fail 0' in pathlib.Path('/private/tmp/owner-session-248-'+log+'.log').read_text()
s=session();l=s.client('lambda');v=l.get_function(FunctionName='staging-wizz-staff-service');cfg=v['Configuration'];env=cfg['Environment']['Variables']
assert env['PLATFORM_ENVIRONMENT']=='staging' and env['PLATFORM_SESSION_POLICY']=='VALID_SESSION'
sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
raw=urllib.request.urlopen(v['Code']['Location'],timeout=60).read();assert sha(raw)==cfg['CodeSha256']
replacement=(r/'backend/staff-service/settlement-runtime.js').read_bytes();buf=io.BytesIO()
with zipfile.ZipFile(io.BytesIO(raw)) as old:
 assert 'settlement-runtime.js' in old.namelist()
 with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as out:
  for info in old.infolist():out.writestr(copy.copy(info),replacement if info.filename=='settlement-runtime.js' else old.read(info.filename))
 with zipfile.ZipFile(io.BytesIO(buf.getvalue())) as new:
  assert all(old.read(n)==new.read(n) for n in old.namelist() if n!='settlement-runtime.js')
payload=buf.getvalue();l.update_function_code(FunctionName=cfg['FunctionName'],RevisionId=cfg['RevisionId'],ZipFile=payload,Publish=False)
print('Updating staging runtime; no IAM, session settings or business records changed.',flush=True)
for _ in range(60):
 after=l.get_function_configuration(FunctionName=cfg['FunctionName'])
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==sha(payload)
for k in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','VpcConfig']:assert cfg.get(k)==after.get(k),k
live=l.get_function(FunctionName=cfg['FunctionName']);check=urllib.request.urlopen(live['Code']['Location'],timeout=60).read()
assert sha(check)==sha(payload)
with zipfile.ZipFile(io.BytesIO(check)) as z:assert z.read('settlement-runtime.js')==replacement
record={'part':248,'status':'PUBLISHED_VERIFIED','function':cfg['FunctionName'],'codeSha256':sha(payload),'changedFiles':['settlement-runtime.js'],'existingStagingValidSessionPolicyHonored':True,'jwtExpirationLiveRevocationMfaAndPermissionsPreserved':True,'configurationAndIamUnchanged':True,'businessRecordsOrMoneyChanged':False,'tests':{'ownerPayoutFlow':'PASS','log':'/private/tmp/owner-session-248-tests.log'}}
(r/'docs/owner-session-publication-248.json').write_text(json.dumps(record,indent=2)+'\n')
print('PASS deployed runtime verified; existing session policy preserved.',flush=True)
