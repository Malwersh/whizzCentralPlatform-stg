"""Follow-up delta: same read permissions; preserve unknown lifetime experience."""
from pathlib import Path
import json,zipfile,copy,hashlib,base64,subprocess,urllib.request,sys
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-performance-projection-291');BASE=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(BASE+list(a));return json.loads(raw)if raw.strip()else{}
assert '--approved-staging-infrastructure'in sys.argv
report=json.loads((R/'docs/driver-performance-projection-publication-291.json').read_text());assert report['status']=='PUBLISHED_BYTE_VERIFIED_FLAGS_STILL_OFF'
for name in ['DriversApi-staging','staging-wizz-staff-service','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout']:
 q=P/name;prior=next(x for x in report['functions']if x['name']==name);cfg=aws('lambda','get-function-configuration','--function-name',name);assert cfg['CodeSha256']==prior['hash']
 z=zipfile.ZipFile(q/'candidate.zip');assert base64.b64encode(hashlib.sha256((q/'candidate.zip').read_bytes()).digest()).decode()==cfg['CodeSha256'];changes={'driver-performance-snapshot.js':(R/'backend/driver-performance-projection/contract.js').read_bytes()}
 if name.startswith('WaveSystem_'):
  s=z.read('dispatch-cycle-runtime.js').decode();needle='projection291.dispatchMetrics(row291,health291,now())';assert s.count(needle)==1;s=s.replace(needle,'projection291.dispatchMetrics(row291,health291,now(),profile.newDriverExemption.belowCompletedTrips)');changes['dispatch-cycle-runtime.js']=s.encode()
 target=q/'boundary-candidate.zip'
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 new=zipfile.ZipFile(target);assert all(new.read(n)==z.read(n)for n in z.namelist()if n not in changes)
 for n,data in changes.items():f=q/('boundary-'+n);f.write_bytes(data);subprocess.run(['node','--check',str(f)],check=True)
 aws('lambda','update-function-code','--function-name',name,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(target));subprocess.check_call(BASE+['lambda','wait','function-updated-v2','--function-name',name]);after=aws('lambda','get-function','--function-name',name);now=after['Configuration'];expected=base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode();assert now['CodeSha256']==expected
 for k in ['Environment','Role','Runtime','Handler','MemorySize','Timeout']:assert now.get(k)==cfg.get(k)
 assert urllib.request.urlopen(after['Code']['Location']).read()==target.read_bytes();prior['previousPublishedHash']=prior['hash'];prior['hash']=expected;prior['boundaryFixVerified']=True;report['status']='PUBLISHED_BYTE_VERIFIED_FLAGS_STILL_OFF';(R/'docs/driver-performance-projection-publication-291.json').write_text(json.dumps(report,indent=2)+'\n');print('Boundary verified '+name,flush=True)
