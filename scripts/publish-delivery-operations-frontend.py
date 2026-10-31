"""Publish only Settings and its new script atop the fresh live Amplify artifact."""
import boto3,json,time,urllib.request,hashlib,zipfile
from pathlib import Path
root=Path('/private/tmp/cod32-release');audit=Path('/private/tmp/cod32-live');s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';a=s.client('amplify');app='d2vmebm1e1n95m';branch='staging';old=json.load(open(audit/'amplify-job.private.json'))
# Artifact snapshot is job61; refuse concurrent deployment or a later successful release.
jobs=a.list_jobs(appId=app,branchName=branch,maxResults=10)['jobSummaries'];assert jobs[0]['jobId']=='61' and jobs[0]['status']=='SUCCEED','AMPLIFY_LIVE_DRIFT'
data=(root/'frontend.zip').read_bytes();assert hashlib.sha256(data).digest()==__import__('base64').b64decode(json.load(open(root/'manifest.json'))['frontend']['codeSha256'])
r=a.create_deployment(appId=app,branchName=branch);req=urllib.request.Request(r['zipUploadUrl'],data=data,method='PUT',headers={'Content-Type':'application/zip'});urllib.request.urlopen(req,timeout=60).read();a.start_deployment(appId=app,branchName=branch,jobId=r['jobId']);print('Amplify job',r['jobId'],'started',flush=True)
while True:
 j=a.get_job(appId=app,branchName=branch,jobId=r['jobId'])['job'];status=j['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(3)
assert status=='SUCCEED',status
z=zipfile.ZipFile(root/'frontend.zip');checks=[]
for name in ['pages/settings.html','settings-delivery-operations.js']:
 url='https://staging.d2vmebm1e1n95m.amplifyapp.com/'+name+'?release=delivery-ops32';response=urllib.request.urlopen(url,timeout=30).read();assert response==z.read(name),(name,'PUBLIC_BYTES_MISMATCH');checks.append({'path':name,'sha256':hashlib.sha256(response).hexdigest()})
(root/'frontend-publication.json').write_text(json.dumps({'jobId':r['jobId'],'status':status,'baseJobId':'61','preservedFiles':175,'changedPaths':checks,'humanWrites':False},indent=2)+'\n');print('Amplify Settings verified',flush=True)
