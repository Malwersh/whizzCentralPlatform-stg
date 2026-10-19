"""Preserve live bundle/config; add only sanitized failure codes to COD integration catch."""
import pathlib,json,importlib.util,zipfile,io,urllib.request,copy,hashlib,base64
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance97');O.mkdir(exist_ok=True)
s=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
l=m.session().client('lambda');f=l.get_function(FunctionName='staging-cod-integration');c=f['Configuration'];data=urllib.request.urlopen(f['Code']['Location']).read();(O/'pricing-base.zip').write_bytes(data);(O/'pricing-config.private.json').write_text(json.dumps(c,default=str));(O/'pricing-config.private.json').chmod(0o600)
with zipfile.ZipFile(io.BytesIO(data)) as old:
 source=old.read('index.js').decode();needle='return createStagingCodIntegration({ db, notificationDelivery: delivery }).run();';assert source.count(needle)==1
 patched=source.replace(needle,'return require("./cod-integration-current.js").createStagingCodIntegration({ db, notificationDelivery: delivery }).run();')
 with zipfile.ZipFile(O/'pricing-candidate.zip','w',zipfile.ZIP_DEFLATED) as z:
  for i in old.infolist():
   assert i.filename!='cod-integration-current.js'
   z.writestr(copy.copy(i),patched.encode() if i.filename=='index.js' else old.read(i.filename))
  z.writestr('cod-integration-current.js',(O/'cod-integration-current.js').read_bytes())
 with zipfile.ZipFile(O/'pricing-candidate.zip') as z:
  assert all(old.read(n)==z.read(n) for n in old.namelist() if n!='index.js')
assert not (pathlib.Path('/private/tmp/finance96/diagnostic-tsc.log').read_text().strip())
assert 'fail 0' in pathlib.Path('/private/tmp/finance96/diagnostic-tests.log').read_text()
a=l.get_function_configuration(FunctionName=c['FunctionName']);assert a['RevisionId']==c['RevisionId'],'LIVE_DRIFT'
data=(O/'pricing-candidate.zip').read_bytes();l.update_function_code(FunctionName=c['FunctionName'],RevisionId=c['RevisionId'],ZipFile=data);l.get_waiter('function_updated_v2').wait(FunctionName=c['FunctionName'],WaiterConfig={'Delay':1,'MaxAttempts':90});a=l.get_function_configuration(FunctionName=c['FunctionName']);assert a['CodeSha256']==base64.b64encode(hashlib.sha256(data).digest()).decode()
for k in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig']:assert a.get(k)==c.get(k),k
result={'published':True,'change':'current COD integration pricing dependency; existing dispatch/scopes/config preserved','configurationPreserved':True,'walletLedgerChanges':False};(O/'pricing-publication.json').write_text(json.dumps(result));print(json.dumps(result))
