from pathlib import Path
import json,subprocess,time,hashlib,base64,urllib.request
R=Path(__file__).resolve().parents[1]; P=Path('/private/tmp/driver-performance-272')
def aws(*args):
 raw=subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*args,'--output','json'])
 return json.loads(raw) if raw.strip() else {}
items=json.loads((R/'docs/driver-performance-packages-272.json').read_text())['functions']
report={'status':'PUBLISHING','explicitUserApproval':True,'functions':[]}; dest=R/'docs/driver-performance-publication-272.json'
def save():dest.write_text(json.dumps(report,indent=2)+'\n')
for i in items:
 c=aws('lambda','get-function-configuration','--function-name',i['function'])
 assert c['CodeSha256']==i['before'] and c['RevisionId']==i['revision'], 'Function drift: '+i['function']
 assert base64.b64encode(hashlib.sha256((P/(i['label']+'-candidate.zip')).read_bytes()).digest()).decode()==i['candidate']
def latest():return aws('amplify','list-jobs','--app-id','d2vmebm1e1n95m','--branch-name','staging','--max-results','1')['jobSummaries'][0]['jobId']
assert latest()=='202','Hosted version drift'
save()
role=json.loads((P/'driver-config.private.json').read_text())['Role'].split('/')[-1]
aws('iam','put-role-policy','--role-name',role,'--policy-name','DriverOfferDisplayReceipt272','--policy-document','file://'+str(R/'docs/driver-offer-receipt-policy-272.json'))
report['iamPolicy']='DriverOfferDisplayReceipt272';save();print('Scoped receipt policy applied',flush=True)
for label in ['financial','staff','driver']:
 i=next(x for x in items if x['label']==label)
 aws('lambda','update-function-code','--function-name',i['function'],'--revision-id',i['revision'],'--zip-file','fileb://'+str(P/(label+'-candidate.zip')))
 subprocess.check_call(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1','lambda','wait','function-updated-v2','--function-name',i['function']])
 c=aws('lambda','get-function-configuration','--function-name',i['function']);assert c['CodeSha256']==i['candidate']
 old=json.loads((P/(label+'-config.private.json')).read_text())
 for k in ['Environment','Role','Handler','MemorySize','Timeout','Runtime']:assert c.get(k)==old.get(k),k
 report['functions'].append({'function':i['function'],'hash':c['CodeSha256'],'revision':c['RevisionId']});save();print('Published '+i['function'],flush=True)
assert latest()=='202','Hosted version drift after Lambda publication'
d=aws('amplify','create-deployment','--app-id','d2vmebm1e1n95m','--branch-name','staging')
req=urllib.request.Request(d['zipUploadUrl'],data=(P/'web-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'})
with urllib.request.urlopen(req,timeout=180) as response:assert response.status in [200,201]
aws('amplify','start-deployment','--app-id','d2vmebm1e1n95m','--branch-name','staging','--job-id',d['jobId'])
report['hostingJobId']=d['jobId'];save()
for _ in range(90):
 s=aws('amplify','get-job','--app-id','d2vmebm1e1n95m','--branch-name','staging','--job-id',d['jobId'])['job']['summary']['status']
 if s=='SUCCEED':break
 assert s not in ['FAILED','CANCELLED'],s
 time.sleep(5)
assert s=='SUCCEED',s
report['status']='PUBLISHED_STAGING';save();print('Hosting published job '+d['jobId'],flush=True)
