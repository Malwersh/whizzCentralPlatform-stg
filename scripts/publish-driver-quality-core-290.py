from pathlib import Path
import json,subprocess,hashlib,base64,urllib.request
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-quality-self-service-290')
def aws(*a):
 b=subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']);return json.loads(b)if b.strip()else{}
items=json.loads((R/'docs/driver-quality-self-service-packages-290.json').read_text())['functions'];selected=[i for i in items if i['label']!='driver']
for i in selected:
 cfg=aws('lambda','get-function-configuration','--function-name',i['function']);assert cfg['CodeSha256']==i['before']and cfg['RevisionId']==i['revision'],'Deployment drift: '+i['function'];assert base64.b64encode(hashlib.sha256((P/(i['label']+'-candidate.zip')).read_bytes()).digest()).decode()==i['candidate']
report={'status':'PUBLISHING_CORE_ONLY','functions':[],'driverApiPublished':False,'driverReleaseInstalled':False,'iamChanges':False,'financialCalculationChanged':False,'businessWritesByAgent':0,'driverReadPermission':'AUTO_REVIEW_REJECTED_AWAITING_EXPLICIT_USER_APPROVAL','humanAcceptance':'DEFERRED_READY_NOT_PASSED'}
def save():(R/'docs/driver-quality-self-service-publication-290.json').write_text(json.dumps(report,indent=2)+'\n')
save()
for i in selected:
 label=i['label'];aws('lambda','update-function-code','--function-name',i['function'],'--revision-id',i['revision'],'--zip-file','fileb://'+str(P/(label+'-candidate.zip')))
 subprocess.check_call(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1','lambda','wait','function-updated-v2','--function-name',i['function']])
 f=aws('lambda','get-function','--function-name',i['function']);cfg=f['Configuration'];old=json.loads((P/(label+'-config.private.json')).read_text());assert cfg['CodeSha256']==i['candidate']
 for field in ['Environment','Role','Handler','Runtime','MemorySize','Timeout']:assert cfg.get(field)==old.get(field),field
 with urllib.request.urlopen(f['Code']['Location'],timeout=45)as response:body=response.read()
 assert body==(P/(label+'-candidate.zip')).read_bytes()
 report['functions'].append({'function':i['function'],'hash':cfg['CodeSha256'],'revision':cfg['RevisionId'],'downloadedByteIdentical':True,'configUnchanged':True});save();print(label,'PUBLISHED_BYTE_VERIFIED',flush=True)
report['status']='CORE_PUBLISHED_DRIVER_API_AND_RELEASE_READY_PERMISSION_PENDING';save();print(report['status'],flush=True)
