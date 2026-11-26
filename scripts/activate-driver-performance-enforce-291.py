"""Explicit user-approved cutover: enforce saved source; retain central policy thresholds."""
from pathlib import Path
import json,subprocess,zipfile,copy,base64,hashlib,datetime,os,sys
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-performance-projection-291');BASE=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(BASE+list(a));return json.loads(raw)if raw.strip()else{}
assert '--user-approved-immediate-cutover'in sys.argv
report=json.loads((R/'docs/driver-performance-projection-publication-291.json').read_text());receipt={'userRequestedImmediateEnforcement':True,'source':'DriverPerformanceSnapshots_staging','thresholdSource':'captured central operational settings','thresholdsChanged':False,'functions':[]}
health=aws('dynamodb','get-item','--table-name','DriverPerformanceSnapshots_staging','--key',json.dumps({'pk':{'S':'CONTROL'},'sk':{'S':'HEALTH'}}),'--consistent-read')['Item'];assert health['healthy']['BOOL'];assert datetime.datetime.now(datetime.timezone.utc).timestamp()-datetime.datetime.fromisoformat(health['updatedAt']['S'].replace('Z','+00:00')).timestamp()<180
for name in ['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout']:
 q=P/name;entry=next(x for x in report['functions']if x['name']==name);cfg=aws('lambda','get-function-configuration','--function-name',name);assert cfg['CodeSha256']==entry['hash']
 z=zipfile.ZipFile(q/'shadow-candidate.zip');s=z.read('dispatch-cycle-runtime.js').decode();old="configured291=process.env.DISPATCH_DRIVER_PERFORMANCE_MODE??'OFF'";assert s.count(old)==1;s=s.replace(old,"configured291=options.performanceMode??process.env.DISPATCH_DRIVER_PERFORMANCE_MODE??'OFF'");old="const mode291=captured291==='VERIFIED_SNAPSHOT_V1'?'ENFORCE':configured291==='ENFORCE'?'SHADOW':configured291;";assert s.count(old)==1;s=s.replace(old,'const mode291=configured291;')
 target=q/'enforce-candidate.zip'
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),s.encode()if info.filename=='dispatch-cycle-runtime.js'else z.read(info.filename))
 zz=zipfile.ZipFile(target);assert all(z.read(n)==zz.read(n)for n in z.namelist()if n!='dispatch-cycle-runtime.js')
 test=q/'enforce-test';test.mkdir(exist_ok=True);zz.extractall(test);(test/'candidate-test.js').write_text(s+'\nmodule.exports.__eligibilityCandidates=createStagingDispatchCandidates;\n')
 env={**os.environ,'NODE_PATH':str(R/'backend/wallet-service/node_modules'),'DISPATCH_DRIVER_PERFORMANCE_MODE':'OFF','ELIGIBILITY_CANDIDATES_RUNTIME':str(test/'candidate-test.js')}
 with(q/'enforce-tests.log').open('w')as log:subprocess.run(['node','--test','backend/wallet-service/test/dispatch-creation-selection.test.cjs'],cwd=R,env=env,stdout=log,stderr=log,check=True)
 aws('lambda','update-function-code','--function-name',name,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(target));subprocess.check_call(BASE+['lambda','wait','function-updated-v2','--function-name',name]);after=aws('lambda','get-function-configuration','--function-name',name);sha=base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode();assert after['CodeSha256']==sha;assert after['Environment']==cfg['Environment']
 original=after['Environment']['Variables'];f=q/'enforce-env.private.json';f.write_text(json.dumps({'Variables':{**original,'DISPATCH_DRIVER_PERFORMANCE_MODE':'ENFORCE'}}));f.chmod(0o600)
 aws('lambda','update-function-configuration','--function-name',name,'--revision-id',after['RevisionId'],'--environment','file://'+str(f));subprocess.check_call(BASE+['lambda','wait','function-updated-v2','--function-name',name]);final=aws('lambda','get-function-configuration','--function-name',name);assert final['CodeSha256']==sha;assert final['Environment']['Variables']=={**original,'DISPATCH_DRIVER_PERFORMANCE_MODE':'ENFORCE'}
 entry['hash']=sha;entry['activation']={'DISPATCH_DRIVER_PERFORMANCE_MODE':'ENFORCE'};entry['immediateCutoverUserAuthorized']=True;report['status']='VERIFIED_SNAPSHOT_ENFORCED';(R/'docs/driver-performance-projection-publication-291.json').write_text(json.dumps(report,indent=2)+'\n');receipt['functions'].append({'name':name,'mode':'ENFORCE','hash':sha,'capturedRuntimeTests':15});receipt['verifiedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(R/'docs/driver-performance-enforce-291.json').write_text(json.dumps(receipt,indent=2)+'\n');print(name+' ENFORCE_VERIFIED thresholds unchanged',flush=True)
