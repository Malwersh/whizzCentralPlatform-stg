import sys,pathlib,json,urllib.request
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');p=pathlib.Path('/private/tmp/cash-adjudication-278');p.mkdir(exist_ok=True)
for label,name in [('financial','staging-driver-financial-accept'),('staff','staging-wizz-staff-service'),('deletion','staging-account-deletion-worker'),('expiry','staging-account-deletion-financial-expiry')]:
 try:r=l.get_function(FunctionName=name)
 except l.exceptions.ResourceNotFoundException:
  print('MISSING FUNCTION',label,name);continue
 (p/(label+'-config.private.json')).write_text(json.dumps(r['Configuration'],default=str));(p/(label+'-base.zip')).write_bytes(urllib.request.urlopen(r['Code']['Location'],timeout=90).read());print(label,r['Configuration']['FunctionName'],r['Configuration']['CodeSha256'],flush=True)
