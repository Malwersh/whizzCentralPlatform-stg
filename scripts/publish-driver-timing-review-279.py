from pathlib import Path
import json,subprocess,base64,hashlib,urllib.request
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-timing-review-279')
def aws(*a):
 raw=subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']);return json.loads(raw)if raw.strip()else{}
items=json.loads((R/'docs/driver-timing-review-packages-279.json').read_text())['functions']
for i in items:
 cfg=aws('lambda','get-function-configuration','--function-name',i['function']);assert cfg['CodeSha256']==i['before']and cfg['RevisionId']==i['revision'],'Deployment drift: '+i['function']
 assert base64.b64encode(hashlib.sha256((P/(i['label']+'-candidate.zip')).read_bytes()).digest()).decode()==i['candidate']
manifest=json.loads((P/'web-manifest.json').read_text());assert aws('amplify','list-jobs','--app-id','d2vmebm1e1n95m','--branch-name','staging','--max-results','1')['jobSummaries'][0]['jobId']==manifest['beforeJob'],'Hosted version drift'
assert all(x['decision']=='allowed'for x in json.loads((P/'iam-verification.json').read_text()))
report={'status':'PUBLISHING','scope':'Evidence-backed timing review and appeals independent of financial settlement','functions':[],'newPermissions':False,'financialCalculationChanged':False,'businessWritesByAgent':0,'humanAcceptance':'DEFERRED_BY_USER_NOT_PASSED'}
def save():(R/'docs/driver-timing-review-publication-279.json').write_text(json.dumps(report,indent=2)+'\n')
save()
for label in ['financial','staff','driver']:
 i=next(a for a in items if a['label']==label)
 aws('lambda','update-function-code','--function-name',i['function'],'--revision-id',i['revision'],'--zip-file','fileb://'+str(P/(label+'-candidate.zip')))
 subprocess.check_call(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1','lambda','wait','function-updated-v2','--function-name',i['function']])
 f=aws('lambda','get-function','--function-name',i['function']);cfg=f['Configuration'];assert cfg['CodeSha256']==i['candidate'];old=json.loads((P/(label+'-config.private.json')).read_text())
 for field in ['Environment','Role','Handler','Runtime','MemorySize','Timeout']:assert cfg.get(field)==old.get(field),field
 with urllib.request.urlopen(f['Code']['Location'],timeout=120)as response:b=response.read()
 assert b==(P/(label+'-candidate.zip')).read_bytes(),'Downloaded package differs'
 report['functions'].append({'function':i['function'],'hash':cfg['CodeSha256'],'revision':cfg['RevisionId'],'downloadedByteIdentical':True,'configUnchanged':True});save();print('Published and byte-verified '+i['function'],flush=True)
manifest=json.loads((P/'web-manifest.json').read_text())
def latest():return aws('amplify','list-jobs','--app-id','d2vmebm1e1n95m','--branch-name','staging','--max-results','1')['jobSummaries'][0]['jobId']
assert latest()==manifest['beforeJob'],'Hosted version drift'
import time
job=aws('amplify','create-deployment','--app-id','d2vmebm1e1n95m','--branch-name','staging')
req=urllib.request.Request(job['zipUploadUrl'],data=(P/'web-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'})
with urllib.request.urlopen(req,timeout=60)as response:assert response.status in [200,201]
aws('amplify','start-deployment','--app-id','d2vmebm1e1n95m','--branch-name','staging','--job-id',job['jobId'])
report['hostingJobId']=job['jobId'];save()
for _ in range(60):
 status=aws('amplify','get-job','--app-id','d2vmebm1e1n95m','--branch-name','staging','--job-id',job['jobId'])['job']['summary']['status']
 if status=='SUCCEED':break
 assert status not in ['FAILED','CANCELLED'],status
 time.sleep(3)
assert status=='SUCCEED',status
import zipfile
z=zipfile.ZipFile(P/'web-candidate.zip')
for n in manifest['changes']:
 with urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?review=279',timeout=30)as response:assert response.read()==z.read(n),n
report['hostingChangedAssetsByteVerified']=manifest['changes'];report['status']='PUBLISHED_STAGING';save();print('Hosted job '+job['jobId']+' published and changed assets byte-verified.',flush=True)
