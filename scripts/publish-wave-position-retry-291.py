"""One guarded StartWave code update; preserve all other ZIP entries and Lambda settings."""
import sys,pathlib,json,copy,zipfile,hashlib,base64,time
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/dispatch-position-291');base=json.loads((p/'config.private.json').read_text());name='WaveSystem_StartWave';assert base['FunctionName']==name
assert 'pass 31' in (p/'host-tests.log').read_text();assert 'pass 41' in (p/'tests.log').read_text();assert not (p/'build.log').read_text().strip()
with zipfile.ZipFile(p/'base.zip') as old:
 assert 'dispatch-cycle-runtime.js' in old.namelist()
 raw=(p/'candidate.js').read_bytes();assert b'financial-delivery-position-retry-291' in raw and b'delivery-composition-284' in raw
 with zipfile.ZipFile(p/'candidate.zip','w',zipfile.ZIP_DEFLATED) as new:
  for info in old.infolist():new.writestr(copy.copy(info),raw if info.filename=='dispatch-cycle-runtime.js' else old.read(info.filename))
 with zipfile.ZipFile(p/'candidate.zip') as new:
  assert old.namelist()==new.namelist();assert all(old.read(n)==new.read(n) for n in old.namelist() if n!='dispatch-cycle-runtime.js')
l=session().client('lambda');current=l.get_function_configuration(FunctionName=name);assert current['CodeSha256']==base['CodeSha256'] and current['RevisionId']==base['RevisionId'],'Concurrent code/config change'
keys=['Role','Handler','Runtime','Timeout','MemorySize','Environment','Layers','Architectures','VpcConfig','TracingConfig','LoggingConfig','EphemeralStorage']
expected=base64.b64encode(hashlib.sha256((p/'candidate.zip').read_bytes()).digest()).decode()
doc=root/'docs/wave-position-retry-publication-291.json';record={'part':291,'status':'PUBLISHING','function':name,'changedFiles':['dispatch-cycle-runtime.js'],'beforeCodeSha256':base['CodeSha256'],'expectedCodeSha256':expected,'unrelatedZipEntriesPreserved':True,'lambdaSettingsChanged':False,'iamChanged':False,'businessDataWritten':False,'manualDispatchOrAssignment':False,'sourceTests':41,'actualHostTests':31};doc.write_text(json.dumps(record,indent=2)+'\n')
l.update_function_code(FunctionName=name,ZipFile=(p/'candidate.zip').read_bytes(),RevisionId=base['RevisionId'],Publish=False);print('Updated StartWave code; waiting for activation.',flush=True)
for _ in range(40):
 after=l.get_function_configuration(FunctionName=name)
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful',after['LastUpdateStatus'];assert after['CodeSha256']==expected
assert all(after.get(k)==base.get(k) for k in keys),'Unexpected settings change'
record['status']='PUBLISHED_CODE_VERIFIED_HUMAN_DELIVERY_PENDING';record['actualCodeSha256']=after['CodeSha256'];doc.write_text(json.dumps(record,indent=2)+'\n');print('PASS: active code hash verified; all settings and unrelated ZIP files preserved.',flush=True)
