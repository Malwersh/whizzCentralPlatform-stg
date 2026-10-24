import sys,pathlib,json,urllib.request,zipfile,io
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
p=pathlib.Path('/private/tmp/findings-235');l=session().client('lambda')
for label,name in [('financial','staging-driver-financial-accept'),('staff','staging-wizz-staff-service')]:
 f=l.get_function(FunctionName=name);raw=urllib.request.urlopen(f['Code']['Location'],timeout=90).read();(p/(label+'-base.zip')).write_bytes(raw);q=p/(label+'-config.private.json');q.write_text(json.dumps(f['Configuration'],default=str));q.chmod(0o600)
 with zipfile.ZipFile(io.BytesIO(raw))as z:
  if label=='financial':(p/'financial-base.js').write_bytes(z.read('index.js'))
  if label=='merchant-orders':(p/'merchant-orders-base.js').write_bytes(z.read('merchant_order_handler.js'))
 print('Captured '+label,flush=True)
