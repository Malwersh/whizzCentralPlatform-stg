"""Scoped staging account-eligibility patch; no order, wallet, profile or IAM mutations."""
import pathlib,json,zipfile,copy,hashlib,base64,boto3
R=pathlib.Path(__file__).resolve().parents[1];P=pathlib.Path('/private/tmp/eligibility-271');L=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda');D=R/'docs/driver-eligibility-271.json';report=json.loads(D.read_text());report['functions']=[]
checks=['eligibility-271-after','eligibility-271-staging-driver-financial-accept-runtime-tests','eligibility-271-WaveSystem_StartWave-runtime-tests','eligibility-271-WaveSystem_HandleWaveTimeout-runtime-tests','eligibility-271-start-candidates-tests','eligibility-271-timeout-candidates-tests']
report['capturedRuntimeChecks']={}
for n in checks:
 s=(pathlib.Path('/private/tmp')/(n+'.log')).read_text();assert 'fail 0' in s,n;report['capturedRuntimeChecks'][n]=next(x for x in s.splitlines()if ' tests 'in x)
functions=[('staging-driver-financial-accept','index.js'),('WaveSystem_StartWave','dispatch-cycle-runtime.js'),('WaveSystem_HandleWaveTimeout','dispatch-cycle-runtime.js')]
for name,_ in functions:
 before=json.loads((P/(name+'.config.json')).read_text());assert L.get_function_configuration(FunctionName=name)['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT '+name
report['status']='PUBLISHING';D.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
for name,target in functions:
 before=L.get_function_configuration(FunctionName=name);original=json.loads((P/(name+'.config.json')).read_text());assert before['CodeSha256']==original['CodeSha256'];candidate=(P/(name+'.candidate.js')).read_bytes()
 with zipfile.ZipFile(P/(name+'.zip'))as old:
  with zipfile.ZipFile(P/(name+'.candidate.zip'),'w',zipfile.ZIP_DEFLATED)as new:
   for ent in old.infolist():new.writestr(copy.copy(ent),candidate if ent.filename==target else old.read(ent.filename))
  with zipfile.ZipFile(P/(name+'.candidate.zip'))as new:assert all(old.read(n)==new.read(n)for n in old.namelist()if n!=target)
 raw=(P/(name+'.candidate.zip')).read_bytes();L.update_function_code(FunctionName=name,RevisionId=before['RevisionId'],ZipFile=raw);L.get_waiter('function_updated_v2').wait(FunctionName=name);after=L.get_function_configuration(FunctionName=name);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(raw).digest()).decode()
 for k in ['Role','Runtime','Handler','Environment','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage']:assert before.get(k)==after.get(k),'CONFIG_DRIFT '+k
 report['functions'].append({'name':name,'before':before['CodeSha256'],'after':after['CodeSha256'],'changedFiles':[target],'otherEntriesPreserved':True,'configurationPreserved':True});D.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print('PUBLISHED',name,flush=True)
report['status']='PUBLISHED_STAGING_ACCOUNT_ACTIVE_GUARD';report['wholeD01Complete']=False;D.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print('DONE_NO_BUSINESS_WRITES',flush=True)
