import sys,json,pathlib,urllib.request,zipfile
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=r/'backend/.tmp/order-exceptions-work/settlement-242-gl';l=session().client('lambda')
for label,name in [('financial','staging-driver-financial-accept'),('staff','staging-wizz-staff-service')]:
 v=l.get_function(FunctionName=name);q=p/(label+'-config.private.json');q.write_text(json.dumps(v['Configuration'],default=str));q.chmod(0o600);(p/(label+'-base.zip')).write_bytes(urllib.request.urlopen(v['Code']['Location'],timeout=90).read())
 if label=='financial':
  with zipfile.ZipFile(p/(label+'-base.zip'))as z:(p/'financial-base.js').write_bytes(z.read('index.js'))
print('PASS captured current financial/staff packages for bounded update.')
