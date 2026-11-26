import sys,pathlib,json,urllib.request,zipfile,concurrent.futures
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
p=pathlib.Path('backend/.tmp/order-exceptions-work/return-240');l=session().client('lambda')
items=[('financial','staging-driver-financial-accept'),('staff','staging-wizz-staff-service'),('merchant','order-receiver-regional-staging-unified-auth-v4-sam'),('driver','DriversApi-staging'),('sla','staging-order-exception-sla-232')]
def capture(pair):
 label,name=pair;f=l.get_function(FunctionName=name);raw=urllib.request.urlopen(f['Code']['Location'],timeout=90).read();(p/(label+'-base.zip')).write_bytes(raw);q=p/(label+'-config.private.json');q.write_text(json.dumps(f['Configuration'],default=str));q.chmod(0o600)
 with zipfile.ZipFile(p/(label+'-base.zip'))as z:
  target={'financial':'index.js','staff':'_discount_review/central-staff/index.js','merchant':'order_returns.js','driver':'lambda_driver_api_v2.js','sla':'index.js'}[label]
  if target in z.namelist():(p/(label+'-base.js')).write_bytes(z.read(target))
 return label+' captured'
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:
 for result in pool.map(capture,items):print(result,flush=True)
