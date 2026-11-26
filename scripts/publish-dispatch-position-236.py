"""Publish bounded position-race retry and START-host review delegation, staging only."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,subprocess
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/dispatch-position-fix');l=session().client('lambda');sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
for name in ['wallet-tests','start-captured-tests','timeout-captured-tests','financial-captured-tests']:
 assert 'ℹ fail 0' in(p/(name+'.log')).read_text(),name
r={'part':236,'status':'PUBLISHING','scope':'STAGING_GENERAL_DISPATCH','functions':[],'moneyOrOrderWritesByAgent':False,'iamChanges':False};doc=root/'docs/dispatch-position-publication-236.json'
for name in ['WaveSystem_HandleWaveTimeout','staging-driver-financial-accept','WaveSystem_StartWave']:
 before=json.loads((p/(name+'.config.private.json')).read_text());current=l.get_function_configuration(FunctionName=name)
 assert current['CodeSha256']==before['CodeSha256'],'LIVE_CODE_DRIFT '+name
 target='index.js' if name=='staging-driver-financial-accept'else'dispatch-cycle-runtime.js'
 candidate=(p/(name+'.candidate.js')).read_bytes()
 subprocess.run(['node','--check',str(p/(name+'.candidate.js'))],check=True)
 with zipfile.ZipFile(p/(name+'.base.zip'))as old:
  assert sha((p/(name+'.base.zip')).read_bytes())==before['CodeSha256']
  assert old.read(target)==(p/(name+'.base.js')).read_bytes()
  outpath=p/(name+'.candidate.zip')
  with zipfile.ZipFile(outpath,'w',zipfile.ZIP_DEFLATED)as out:
   for info in old.infolist():out.writestr(copy.copy(info),candidate if info.filename==target else old.read(info.filename))
  with zipfile.ZipFile(outpath)as out:assert all(old.read(n)==out.read(n)for n in old.namelist()if n!=target)
 raw=outpath.read_bytes();l.update_function_code(FunctionName=name,RevisionId=current['RevisionId'],ZipFile=raw,Publish=False)
 for _ in range(60):
  after=l.get_function_configuration(FunctionName=name)
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha(raw)
 for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage']:assert current.get(k)==after.get(k),'CONFIG_DRIFT '+k
 r['functions'].append({'name':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedFiles':[target],'otherZipEntriesIdentical':True,'configurationPreserved':True});doc.write_text(json.dumps(r,indent=2)+'\n');print('Published '+name,flush=True)
r['status']='PUBLISHED';doc.write_text(json.dumps(r,indent=2)+'\n')
