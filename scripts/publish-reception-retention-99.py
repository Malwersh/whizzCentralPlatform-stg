"""Compatibility for terminal deadline events; no worker invocation or IAM changes."""
from pathlib import Path
import importlib.util,json,io,zipfile,urllib.request,hashlib,base64,time
R=Path(__file__).resolve().parents[1];O=Path('/private/tmp/finance98');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);l=m.session().client('lambda');assert 'fail 0' in (O/'retention99-tests.log').read_text();changes=(R/'backend/account-deletion/cod-retention.js').read_bytes();result=[]
for name in ['staging-account-deletion-worker','staging-account-deletion-financial-expiry']:
 f=l.get_function(FunctionName=name);c=f['Configuration'];olddata=None
 for attempt in range(3):
  try:olddata=urllib.request.urlopen(f['Code']['Location'],timeout=45).read();break
  except (OSError,urllib.error.URLError):
   if attempt==2:raise
   time.sleep(2);f=l.get_function(FunctionName=name)
 assert olddata;
 (O/(name+'.before99.zip')).write_bytes(olddata);p=O/(name+'.config-before99.private.json');p.write_text(json.dumps(c,default=str));p.chmod(0o600);buf=io.BytesIO()
 with zipfile.ZipFile(io.BytesIO(olddata)) as old,zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as new:
  assert 'cod-retention.js' in old.namelist()
  for n in old.namelist():new.writestr(n,changes if n=='cod-retention.js' else old.read(n))
  assert all(old.read(n)==new.read(n) for n in old.namelist() if n!='cod-retention.js')
 current=l.get_function_configuration(FunctionName=name);assert current['RevisionId']==c['RevisionId'];data=buf.getvalue();l.update_function_code(FunctionName=name,RevisionId=c['RevisionId'],ZipFile=data);l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':1,'MaxAttempts':60});a=l.get_function_configuration(FunctionName=name);assert a['CodeSha256']==base64.b64encode(hashlib.sha256(data).digest()).decode()
 for k in ['Environment','Role','Runtime','Handler','Timeout','Layers','Architectures']:assert a.get(k)==c.get(k)
 result.append(name);print(json.dumps({'retentionCompatibilityPublished':name}),flush=True)
(O/'retention99-publication.json').write_text(json.dumps({'functions':result,'configurationPreserved':True,'workersInvoked':False},indent=2))
