"""Expand SHADOW observation to all eligibility counters, preserving selection/config."""
from pathlib import Path
import json,subprocess,zipfile,copy,base64,hashlib,sys
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-performance-projection-291');BASE=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(BASE+list(a));return json.loads(raw)if raw.strip()else{}
assert '--approved-staging-infrastructure'in sys.argv
report=json.loads((R/'docs/driver-performance-projection-publication-291.json').read_text())
for name in ['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout']:
 q=P/name;prior=next(x for x in report['functions']if x['name']==name);cfg=aws('lambda','get-function-configuration','--function-name',name);assert cfg['CodeSha256']==prior['hash']
 z=zipfile.ZipFile(q/'boundary-candidate.zip');s=z.read('dispatch-cycle-runtime.js').decode()
 old="const pending291=new Set();";assert s.count(old)==1;s=s.replace(old,old+"const shadow291={checked:0,current:0,different:0,pending:0};")
 old="if(mode291==='ENFORCE'){if(!metrics291){pending291.add(driverId);continue;}Object.assign(state,metrics291);}else console.info('DRIVER_PERFORMANCE_SHADOW',{current:!!metrics291,different:!!metrics291&&state.metricsSnapshot_completionRate!==metrics291.metricsSnapshot_completionRate});"
 new="shadow291.checked++;if(metrics291){shadow291.current++;if(['metricsSnapshot_acceptanceRate','metricsSnapshot_completionRate','metricsSnapshot_consecutiveRejections','metricsSnapshot_totalTrips'].some(k=>state[k]!==metrics291[k]))shadow291.different++;}else shadow291.pending++;if(mode291==='ENFORCE'){if(!metrics291){pending291.add(driverId);continue;}Object.assign(state,metrics291);}"
 assert s.count(old)==1;s=s.replace(old,new);old='return candidates.slice(';assert s.count(old)==1;s=s.replace(old,"if(mode291==='SHADOW')console.info('DRIVER_PERFORMANCE_SHADOW',shadow291);\n    "+old)
 target=q/'shadow-candidate.zip'
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),s.encode()if info.filename=='dispatch-cycle-runtime.js'else z.read(info.filename))
 (q/'shadow-runtime.js').write_text(s);subprocess.run(['node','--check',str(q/'shadow-runtime.js')],check=True)
 test=q/'shadow-final-test';test.mkdir(exist_ok=True);zipfile.ZipFile(target).extractall(test);(test/'candidate-test.js').write_text(s+'\nmodule.exports.__eligibilityCandidates=createStagingDispatchCandidates;\n')
 import os
 env={**os.environ,'NODE_PATH':str(R/'backend/wallet-service/node_modules'),'DISPATCH_DRIVER_PERFORMANCE_MODE':'ENFORCE','ELIGIBILITY_CANDIDATES_RUNTIME':str(test/'candidate-test.js')}
 with(q/'shadow-tests.log').open('w')as log:subprocess.run(['node','--test','backend/wallet-service/test/dispatch-creation-selection.test.cjs'],cwd=R,env=env,stdout=log,stderr=log,check=True)
 aws('lambda','update-function-code','--function-name',name,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(target));subprocess.check_call(BASE+['lambda','wait','function-updated-v2','--function-name',name]);after=aws('lambda','get-function-configuration','--function-name',name);expected=base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode();assert after['CodeSha256']==expected
 for k in ['Environment','Role','Runtime','Handler','MemorySize','Timeout']:assert after.get(k)==cfg.get(k)
 prior['previousPublishedHash']=prior['hash'];prior['hash']=expected;prior['shadowAllEligibilityCountersObserved']=True;prior['capturedRuntimeTests']=15;(R/'docs/driver-performance-projection-publication-291.json').write_text(json.dumps(report,indent=2)+'\n');print(name+' SHADOW_ALL_COUNTERS_TESTED_PUBLISHED',flush=True)
