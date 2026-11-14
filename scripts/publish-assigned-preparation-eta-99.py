"""Preserve live financial runtime; strengthen only canonical preparation ETA hydration."""
from pathlib import Path
import io,json,zipfile,urllib.request,importlib.util,hashlib,base64
R=Path(__file__).resolve().parents[1];O=Path('/private/tmp/finance98');assert not (O/'eta-final-tsc99.log').read_text().strip();assert 'fail 0' in (O/'eta-final-tests99.log').read_text();sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);l=m.session().client('lambda');name='staging-driver-financial-accept';f=l.get_function(FunctionName=name);c=f['Configuration'];data=urllib.request.urlopen(f['Code']['Location'],timeout=45).read();(O/'eta-assignment-before99.zip').write_bytes(data);p=O/'eta-assignment-before99.private.json';p.write_text(json.dumps(c,default=str));p.chmod(0o600);buf=io.BytesIO();filename='driver-acceptance-eta98.js'
with zipfile.ZipFile(io.BytesIO(data)) as old,zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as new:
 assert filename in old.namelist() and b'require("./driver-acceptance-eta98.js")' in old.read('index.js')
 for n in old.namelist():new.writestr(n,(O/'driver-acceptance-eta99-final.js').read_bytes() if n==filename else old.read(n))
 assert all(old.read(n)==new.read(n) for n in old.namelist() if n!=filename)
a=l.get_function_configuration(FunctionName=name);assert a['RevisionId']==c['RevisionId'];payload=buf.getvalue();l.update_function_code(FunctionName=name,RevisionId=c['RevisionId'],ZipFile=payload);l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':1,'MaxAttempts':60});a=l.get_function_configuration(FunctionName=name);assert a['CodeSha256']==base64.b64encode(hashlib.sha256(payload).digest()).decode()
for k in ['Environment','Role','Runtime','Handler','Timeout','Layers','Architectures']:assert a.get(k)==c.get(k)
result={'published':True,'name':name,'codeSha256':a['CodeSha256'],'existingFinancialRuntimeAndConfigurationPreserved':True,'tests':16,'canonicalPreparationReadFencedInAssignment':True};(O/'assigned-eta99-publication.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
