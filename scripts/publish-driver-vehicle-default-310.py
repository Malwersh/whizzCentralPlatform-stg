"""Overlay only the two mutation cores on verified live staging packages."""
from pathlib import Path
import json,zipfile,subprocess,copy,hashlib,base64,urllib.request
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/driver-vehicles-310';P.mkdir(parents=True,exist_ok=True)
B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw)if raw.strip()else{}
report_path=R/'docs/driver-vehicle-publication-308.json';report=json.loads(report_path.read_text())
assert 'ℹ pass 24' in Path('/private/tmp/vehicles-310-core-tests.log').read_text()
core=(R/'backend/shared/driver-vehicles-308.js').read_bytes();results=[]
for name,filename in [('DriversApi-staging','driver-vehicles-308.js'),('staging-wizz-staff-service','driver-vehicles-core-308.js')]:
 row=next(x for x in report['functions']if x['name']==name)
 live=aws('lambda','get-function','--function-name',name);cfg=live['Configuration']
 assert cfg['CodeSha256']==row['hash'],'LIVE_DRIFT '+name
 base=P/(name+'-base.zip');urllib.request.urlretrieve(live['Code']['Location'],base)
 assert base64.b64encode(hashlib.sha256(base.read_bytes()).digest()).decode()==row['hash']
 z=zipfile.ZipFile(base);assert filename in z.namelist();target=P/(name+'.zip')
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),core if info.filename==filename else z.read(info.filename))
 with zipfile.ZipFile(target)as patched:
  assert all(patched.read(i)==z.read(i)for i in z.namelist()if i!=filename)
 digest=base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode()
 aws('lambda','update-function-code','--function-name',name,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(target))
 subprocess.run(B+['lambda','wait','function-updated-v2','--function-name',name],check=True)
 after=aws('lambda','get-function-configuration','--function-name',name)
 assert after['CodeSha256']==digest and after['Environment']==cfg['Environment']and after['Role']==cfg['Role']and after['LastUpdateStatus']=='Successful'
 results.append({'name':name,'beforeHash':row['hash'],'hash':digest,'changedFiles':[filename],'otherEntriesPreserved':True,'configurationPreserved':True})
 row['hash']=digest;report_path.write_text(json.dumps(report,indent=2)+'\n')
 receipt={'status':'PUBLISHED_VERIFIED' if len(results)==2 else 'PUBLISHING','functions':results,'businessDataMutatedDirectly':False,'rule':'Sole nonremoved approved vehicle becomes default; existing selection and multi-vehicle choice never changed automatically','tests':{'core':24,'flutterVehicleManagement':5,'activeStaffRoute':'PASS'}}
 (R/'docs/driver-vehicle-default-310.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print('Published and hash-verified',name,flush=True)
