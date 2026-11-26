"""Keep merchant staff identity and reception preferences out of public order DTOs."""
from pathlib import Path
import json,io,zipfile,urllib.request,importlib.util,hashlib,base64,time,re
R=Path(__file__).resolve().parents[1];O=Path('/private/tmp/finance98');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);l=m.session().client('lambda');result=[]
for name in ['WizzUser-CreateOrder-staging','WizzUser-GetOrder-staging','WizzUser-GetUserOrders-staging']:
 f=l.get_function(FunctionName=name);c=f['Configuration'];data=None
 for attempt in range(3):
  try:data=urllib.request.urlopen(f['Code']['Location'],timeout=45).read();break
  except OSError:
   if attempt==2:raise
   time.sleep(2);f=l.get_function(FunctionName=name)
 assert data;(O/(name+'.public-view-before99.zip')).write_bytes(data);p=O/(name+'.public-view-before99.private.json');p.write_text(json.dumps(c,default=str));p.chmod(0o600);buf=io.BytesIO();filename='functions/create-order/commercial-order-router.js'
 with zipfile.ZipFile(io.BytesIO(data)) as old,zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as new:
  source=old.read(filename).decode();needle='financialSearch, ...view';assert source.count(needle)==1
  changed=source.replace(needle,'financialSearch, merchantResponseActor, merchantResponsePolicy, ...view')
  for n in old.namelist():new.writestr(n,changed if n==filename else old.read(n))
  assert all(old.read(n)==new.read(n) for n in old.namelist() if n!=filename)
 a=l.get_function_configuration(FunctionName=name);assert a['RevisionId']==c['RevisionId'];payload=buf.getvalue();l.update_function_code(FunctionName=name,RevisionId=c['RevisionId'],ZipFile=payload);l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':1,'MaxAttempts':60});a=l.get_function_configuration(FunctionName=name);assert a['CodeSha256']==base64.b64encode(hashlib.sha256(payload).digest()).decode()
 for k in ['Environment','Role','Handler','Runtime','Timeout','Layers','Architectures']:assert a.get(k)==c.get(k)
 result.append(name);print(json.dumps({'publicResponseProtected':name}),flush=True)
(O/'customer-view99-publication.json').write_text(json.dumps({'functions':result,'onlyNewInternalFieldsRemoved':True},indent=2))
