from pathlib import Path
import json,subprocess,zipfile,copy,re,urllib.request,time
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/performance-hidden-20261025');base=Path('/private/tmp/case-ORD1792911323338/web-candidate.zip')
def aws(*a):return json.loads(subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']))
latest=aws('amplify','list-jobs','--app-id','d2vmebm1e1n95m','--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId']=='208'and latest['status']=='SUCCEED','Hosted version drift'
z=zipfile.ZipFile(base);changes={'driver-performance-case.js':(R/'frontend/driver-performance-case.js').read_bytes()}
s=z.read('pages/order-exceptions.html').decode();s,n=re.subn(r'(driver-performance-case\.js\?v=)[^\"]+',r'\g<1>visible-20261025',s);assert n==1;changes['pages/order-exceptions.html']=s.encode()
candidate=P/'web-candidate.zip'
with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED)as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
new=zipfile.ZipFile(candidate);assert all(new.read(n)==z.read(n)for n in z.namelist()if n not in changes)
job=aws('amplify','create-deployment','--app-id','d2vmebm1e1n95m','--branch-name','staging');req=urllib.request.Request(job['zipUploadUrl'],data=candidate.read_bytes(),method='PUT',headers={'Content-Type':'application/zip'})
with urllib.request.urlopen(req,timeout=45)as response:assert response.status in[200,201]
aws('amplify','start-deployment','--app-id','d2vmebm1e1n95m','--branch-name','staging','--job-id',job['jobId'])
for _ in range(60):
 state=aws('amplify','get-job','--app-id','d2vmebm1e1n95m','--branch-name','staging','--job-id',job['jobId'])['job']['summary']['status']
 if state=='SUCCEED':break
 assert state not in['FAILED','CANCELLED'];time.sleep(2)
assert state=='SUCCEED'
for n,body in changes.items():
 for attempt in range(10):
  with urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?cancel-case='+str(attempt),timeout=20)as response:matched=response.read()==body
  if matched:break
  time.sleep(2)
 assert matched,n
receipt={'status':'PUBLISHED_BYTE_VERIFIED','hostingJob':job['jobId'],'previousHostingJob':'208','changedFiles':list(changes),'allOtherHostedEntriesIdentical':True,'businessMutations':False,'caseOrder':'ORD1792911323338','fix':'Performance review directly below case summary; explicit unavailable or permission states; no financial or performance decisions changed.'};(R/'docs/performance-case-placement-20261025.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt),flush=True)
