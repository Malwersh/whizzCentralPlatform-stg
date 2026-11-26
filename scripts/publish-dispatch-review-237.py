import sys,pathlib,json,zipfile,copy,hashlib,base64,time,subprocess
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=root/'backend/.tmp/order-exceptions-work/review-237';l=session().client('lambda');sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
for n in ['staff-tests','captured-review-tests','executor-tests']:assert 'ℹ fail 0'in(p/(n+'.log')).read_text()
assert 'PASS 'in(p/'compatibility-tests.log').read_text()
before=json.loads((p/'staff-config.private.json').read_text());name=before['FunctionName'];c=l.get_function_configuration(FunctionName=name);assert c['CodeSha256']==before['CodeSha256'],'CODE_DRIFT'
target='_discount_review/central-staff/index.js';rawjs=(p/'staff-candidate.js').read_bytes();subprocess.run(['node','--check',str(p/'staff-candidate.js')],check=True)
with zipfile.ZipFile(p/'staff-base.zip')as old:
 assert sha((p/'staff-base.zip').read_bytes())==before['CodeSha256']
 with zipfile.ZipFile(p/'staff-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for info in old.infolist():out.writestr(copy.copy(info),rawjs if info.filename==target else old.read(info.filename))
 with zipfile.ZipFile(p/'staff-candidate.zip')as out:assert all(old.read(n)==out.read(n)for n in old.namelist()if n!=target)
raw=(p/'staff-candidate.zip').read_bytes();l.update_function_code(FunctionName=name,RevisionId=c['RevisionId'],ZipFile=raw,Publish=False)
for _ in range(60):
 after=l.get_function_configuration(FunctionName=name)
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha(raw)
for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage']:assert c.get(k)==after.get(k),k
r={'part':237,'status':'PUBLISHED','function':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedFiles':[target],'otherZipEntriesIdentical':True,'configurationPreserved':True,'iamChanges':False,'moneyOrOrderWritesByAgent':False,'tests':{'staff':242,'capturedReview':17,'executor':24,'digestCompatibility':'PASS'}}
(root/'docs/dispatch-review-general-publication-237.json').write_text(json.dumps(r,indent=2)+'\n');print('Published general operational review access on staging; configuration preserved.',flush=True)
