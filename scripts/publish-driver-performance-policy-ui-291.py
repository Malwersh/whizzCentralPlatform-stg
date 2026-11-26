from pathlib import Path
import json,subprocess,zipfile,copy,re,urllib.request,time,sys
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-performance-projection-291');BASE=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(BASE+list(a));return json.loads(raw)if raw.strip()else{}
assert '--approved-staging-infrastructure'in sys.argv
latest=aws('amplify','list-jobs','--app-id','d2vmebm1e1n95m','--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId']=='209'and latest['status']=='SUCCEED','Hosted version drift'
z=zipfile.ZipFile('/private/tmp/performance-hidden-20261025/web-candidate.zip');changes={'settings-delivery-operations.js':(R/'frontend/settings-delivery-operations.js').read_bytes()};s=z.read('pages/settings.html').decode();s,n=re.subn(r'(settings-delivery-operations\.js\?v=)[^\"]+',r'\g<1>performance-source-291',s);assert n==1;changes['pages/settings.html']=s.encode()
candidate=P/'web-candidate.zip'
with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED)as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
new=zipfile.ZipFile(candidate);assert all(new.read(n)==z.read(n)for n in z.namelist()if n not in changes)
job=aws('amplify','create-deployment','--app-id','d2vmebm1e1n95m','--branch-name','staging');req=urllib.request.Request(job['zipUploadUrl'],data=candidate.read_bytes(),method='PUT',headers={'Content-Type':'application/zip'})
with urllib.request.urlopen(req,timeout=45)as response:assert response.status in[200,201]
aws('amplify','start-deployment','--app-id','d2vmebm1e1n95m','--branch-name','staging','--job-id',job['jobId'])
receipt={'status':'HOSTING_DEPLOYING','hostingJob':job['jobId'],'previousHostingJob':'209','changedFiles':list(changes),'allOtherEntriesPreserved':True,'operationalSettingsWrittenByAgent':False}
f=R/'docs/driver-performance-policy-ui-291.json';f.write_text(json.dumps(receipt,indent=2)+'\n')
for _ in range(30):
 state=aws('amplify','get-job','--app-id','d2vmebm1e1n95m','--branch-name','staging','--job-id',job['jobId'])['job']['summary']['status']
 if state=='SUCCEED':break
 assert state not in['FAILED','CANCELLED'];time.sleep(2)
assert state=='SUCCEED'
for name,body in changes.items():
 for n in range(10):
  if urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+name+'?projection291='+str(n),timeout=30).read()==body:break
  time.sleep(2)
 else:raise AssertionError('Hosted bytes differ: '+name)
receipt['status']='PUBLISHED_BYTE_VERIFIED';f.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt),flush=True)
