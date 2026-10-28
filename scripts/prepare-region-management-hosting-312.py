from pathlib import Path
import json,subprocess,urllib.request,urllib.error,zipfile,copy,shutil,re,hashlib
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/regions-312';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*args):return json.loads(subprocess.check_output(B+list(args)+['--output','json']))
latest=aws('amplify','list-jobs','--app-id','d2vmebm1e1n95m','--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['status']=='SUCCEED'
job=aws('amplify','get-job','--app-id','d2vmebm1e1n95m','--branch-name','staging','--job-id',latest['jobId']);urls=[s['artifactsUrl']for s in job['job']['steps']if s.get('artifactsUrl')];assert urls
try:urllib.request.urlretrieve(urls[-1],P/'hosting-base.zip')
except urllib.error.HTTPError as e:
 if e.code!=404:raise
 old=json.loads((R/'docs/driver-vehicle-ui-publication-308.json').read_text());assert old['status']=='PUBLISHED_BYTE_VERIFIED'and old['hostingJob']==latest['jobId'],'UNKNOWN_HOSTING_BASE'
 known=R/'backend/.tmp/driver-vehicles-308/hosting-candidate.zip';z=zipfile.ZipFile(known)
 for f in ['pages/regions.html','regions.js','assets/js/rbac.js','pages/drivers.html','drivers.js','driver-vehicles.js']:
  assert urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+f+'?regions312=base',timeout=30).read()==z.read(f),'HOSTED_BASE_DRIFT '+f
 shutil.copyfile(known,P/'hosting-base.zip')
z=zipfile.ZipFile(P/'hosting-base.zip');page=z.read('pages/regions.html').decode();old=re.search(r'<script src="\.\./regions\.js(?:\?[^\"]*)?"></script>',page).group(0);assert page.count(old)==1
new='<link rel="stylesheet" href="../region-management-312.css?v=312">\n    <script src="../region-geometry-runtime-312.js?v=312"></script>\n    <script src="../region-management-312.js?v=312"></script>'
page=page.replace(old,new).replace('../assets/js/rbac.js?v=20261017-ar1','../assets/js/rbac.js?v=312-regions');assert page.encode()==(R/'frontend/pages/regions.html').read_bytes(),'LOCAL_REGION_PAGE_DIFFERS_FROM_VERIFIED_HOST_BASE'
rbac=z.read('assets/js/rbac.js').decode();anchor="'drivers.html':'drivers.read'";assert rbac.count(anchor)==1;rbac=rbac.replace(anchor,anchor+",'regions.html':'regions.read'")
assert rbac.encode()==(R/'frontend/assets/js/rbac.js').read_bytes(),'LOCAL_RBAC_DIFFERS_FROM_VERIFIED_HOST_BASE'
changes={'pages/regions.html':page.encode(),'assets/js/rbac.js':rbac.encode()}
for f in ['region-management-312.js','region-management-312.css','region-geometry-worker-312.js','region-geometry-runtime-312.js']:changes[f]=(R/'frontend'/f).read_bytes()
with zipfile.ZipFile(P/'hosting-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 for f,b in changes.items():
  if f not in z.namelist():out.writestr(f,b)
with zipfile.ZipFile(P/'hosting-candidate.zip')as after:assert all(after.read(f)==z.read(f)for f in z.namelist()if f not in changes)
review={'previousHostingJob':latest['jobId'],'changedFiles':list(changes),'otherEntriesPreserved':True,'sourceHashes':{f:hashlib.sha256(v).hexdigest()for f,v in changes.items()}}
(P/'hosting-review.json').write_text(json.dumps(review,indent=2)+'\n');print('Prepared region UI overlay preserving unrelated files from hosting job',latest['jobId'],flush=True)
