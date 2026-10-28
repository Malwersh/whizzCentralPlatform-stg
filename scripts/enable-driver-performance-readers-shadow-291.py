"""Approved staging activation: shared API reads, waves SHADOW; no policy changes."""
from pathlib import Path
import json,subprocess,sys,datetime
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-performance-projection-291');BASE=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*args):
 raw=subprocess.check_output(BASE+list(args));return json.loads(raw)if raw.strip()else{}
assert '--approved-staging-infrastructure' in sys.argv
proof=json.loads((R/'docs/driver-performance-projection-persisted-verification-291.json').read_text());assert proof['allCurrent'] and all(x['parity']for x in proof['drivers'])
report=json.loads((R/'docs/driver-performance-projection-publication-291.json').read_text())
for name,key,value in [('DriversApi-staging','DRIVER_PERFORMANCE_SNAPSHOT_READS_ENABLED','true'),('WaveSystem_StartWave','DISPATCH_DRIVER_PERFORMANCE_MODE','SHADOW'),('WaveSystem_HandleWaveTimeout','DISPATCH_DRIVER_PERFORMANCE_MODE','SHADOW')]:
 cfg=aws('lambda','get-function-configuration','--function-name',name);entry=next(x for x in report['functions']if x['name']==name);assert cfg['CodeSha256']==entry['hash']
 old=cfg.get('Environment',{}).get('Variables',{});env={'Variables':{**old,key:value}};path=P/(name+'-read-env.private.json');path.write_text(json.dumps(env));path.chmod(0o600)
 if old.get(key)!=value:
  aws('lambda','update-function-configuration','--function-name',name,'--revision-id',cfg['RevisionId'],'--environment','file://'+str(path));subprocess.check_call(BASE+['lambda','wait','function-updated-v2','--function-name',name])
 after=aws('lambda','get-function-configuration','--function-name',name);assert after['CodeSha256']==entry['hash'];assert after['Environment']['Variables']==env['Variables'];entry['activation']={key:value};entry['configurationPreservedExceptActivationFlag']=True
 report['status']='SHARED_READS_ENABLED_WAVES_SHADOW';report['operationalPolicyWrittenByAgent']=False;report['activatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(R/'docs/driver-performance-projection-publication-291.json').write_text(json.dumps(report,indent=2)+'\n');print(name+' '+key+'='+value,flush=True)
