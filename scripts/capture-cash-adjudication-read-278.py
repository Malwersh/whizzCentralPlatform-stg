import sys,pathlib,json,urllib.request,zipfile
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');p=pathlib.Path('/private/tmp/cash-adjudication-278-read')
for label,name in [('staff','staging-wizz-staff-service'),('wallet','staging-wizz-wallet-service'),('lifecycle','staging-wizz-wallet-lifecycle')]:
 r=l.get_function(FunctionName=name);(p/(label+'-config.private.json')).write_text(json.dumps(r['Configuration'],default=str));raw=urllib.request.urlopen(r['Code']['Location'],timeout=90).read();(p/(label+'-base.zip')).write_bytes(raw)
 if label=='staff':(p/'staff-runtime-base.js').write_bytes(zipfile.ZipFile(p/(label+'-base.zip')).read('settlement-runtime.js'))
 print('Captured '+label,flush=True)
