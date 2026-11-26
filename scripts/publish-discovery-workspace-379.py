"""Overlay the reviewed home discovery editor only, preserving the live site."""
from pathlib import Path
import subprocess,json,urllib.request,zipfile,hashlib,time
R=Path(__file__).resolve().parents[1];P=Path('/tmp/discovery379');B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m';BASE='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def aws(*a):return json.loads(subprocess.check_output(B+list(a)))
latest=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['status']=='SUCCEED'
job=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',latest['jobId']);url=next(s['artifactsUrl'] for s in job['job']['steps'] if s.get('artifactsUrl'));urllib.request.urlretrieve(url,P/'hosting-before.zip')
with zipfile.ZipFile(P/'hosting-before.zip') as z:
 data={n:z.read(n) for n in z.namelist()};files=['pages/home-layout.html','home-layout.js'];before={};after={}
 for name in files:
  assert urllib.request.urlopen(BASE+name+'?before379='+latest['jobId'],timeout=40).read()==data[name],name+' live drift'
  before[name]=hashlib.sha256(data[name]).hexdigest();data[name]=(R/'frontend'/name).read_bytes();after[name]=hashlib.sha256(data[name]).hexdigest()
 with zipfile.ZipFile(P/'hosting-candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for n,b in data.items():out.writestr(n,b)
 assert all(data[n]==z.read(n) for n in z.namelist() if n not in files)
current=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert current['jobId']==latest['jobId'] and current['status']=='SUCCEED','HOSTING_DRIFT'
d=aws('amplify','create-deployment','--app-id',APP,'--branch-name','staging');urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=(P/'hosting-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=60).read();aws('amplify','start-deployment','--app-id',APP,'--branch-name','staging','--job-id',d['jobId']);print('Hosting started',d['jobId'],flush=True)
record={'part':379,'status':'HOSTING_PUBLISHING','environment':'staging','hostingJob':d['jobId'],'previousHostingJob':latest['jobId'],'files':files,'beforeSha256':before,'afterSha256':after,'authoredDataChanged':False,'backendChanged':False,'browserChecks':{'widths':[390,1280],'workflow':['define classification','assign branch','assign category and product separately','save catalog then open strip','save strip draft without publishing','review and publish','edit price category separately without losing classification mappings']},'design':['Three numbered strip cards in app order','Classification dictionary separated from presentation settings','Guided definition and branch assignment with optional menu assignment','Only selected menu item is edited at a time','Optional brands separated','Price categories managed from price filter settings','Advanced navigation targeting and media collapsed','Compact filter summaries','Explicit immediate/draft/menu publication explanations','Unsaved dictionary close confirmation and stale async response guards']};dest=R/'docs/discovery-workspace-379.json'
def save():dest.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
save()
for _ in range(50):
 status=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',d['jobId'])['job']['summary']['status']
 if status=='SUCCEED':break
 assert status not in ['FAILED','CANCELLED'];time.sleep(2)
else:raise RuntimeError('Deployment pending')
for name in files:assert urllib.request.urlopen(BASE+name+'?after379='+d['jobId'],timeout=40).read()==data[name]
record['status']='PUBLISHED_VERIFIED';save();print('Hosting verified',flush=True)
