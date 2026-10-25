from pathlib import Path
import json,subprocess,base64,hashlib,urllib.request
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-performance-273')
def aws(*a):
 raw=subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']);return json.loads(raw)if raw.strip()else{}
items=json.loads((R/'docs/driver-performance-packages-273.json').read_text())['functions']
for i in items:
 cfg=aws('lambda','get-function-configuration','--function-name',i['function']);assert cfg['CodeSha256']==i['before']and cfg['RevisionId']==i['revision'],'Deployment drift: '+i['function']
 assert base64.b64encode(hashlib.sha256((P/(i['label']+'-candidate.zip')).read_bytes()).digest()).decode()==i['candidate']
report={'status':'PUBLISHING','scope':'Original timing per assignment, first server observation, own performance detail and thirty-day acceptance activity','functions':[],'newPermissions':False,'financialCalculationChanged':False,'businessWritesByAgent':0,'humanAcceptance':'DEFERRED_BY_USER_NOT_PASSED'}
def save():(R/'docs/driver-performance-publication-273.json').write_text(json.dumps(report,indent=2)+'\n')
save()
for label in ['financial','driver']:
 i=next(a for a in items if a['label']==label)
 aws('lambda','update-function-code','--function-name',i['function'],'--revision-id',i['revision'],'--zip-file','fileb://'+str(P/(label+'-candidate.zip')))
 subprocess.check_call(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1','lambda','wait','function-updated-v2','--function-name',i['function']])
 f=aws('lambda','get-function','--function-name',i['function']);cfg=f['Configuration'];assert cfg['CodeSha256']==i['candidate'];old=json.loads((P/(label+'-config.private.json')).read_text())
 for field in ['Environment','Role','Handler','Runtime','MemorySize','Timeout']:assert cfg.get(field)==old.get(field),field
 with urllib.request.urlopen(f['Code']['Location'],timeout=120)as response:b=response.read()
 assert b==(P/(label+'-candidate.zip')).read_bytes(),'Downloaded package differs'
 report['functions'].append({'function':i['function'],'hash':cfg['CodeSha256'],'revision':cfg['RevisionId'],'downloadedByteIdentical':True,'configUnchanged':True});save();print('Published and byte-verified '+i['function'],flush=True)
report['status']='PUBLISHED_STAGING';save()
