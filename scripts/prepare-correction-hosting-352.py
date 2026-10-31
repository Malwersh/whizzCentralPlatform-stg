"""Prepare hosting delta on latest staging artifact; do not publish."""
from pathlib import Path
import json,subprocess,urllib.request,zipfile,io,copy,hashlib,re,difflib
R=Path(__file__).resolve().parents[1];O=R/'backend/.tmp/post-payout-352/hosting';O.mkdir(parents=True,exist_ok=True)
B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):return json.loads(subprocess.check_output(B+list(a)+['--output','json']))
a={'appId':'d2vmebm1e1n95m','branchName':'staging'}
base=aws('amplify','list-jobs','--app-id',a['appId'],'--branch-name',a['branchName'],'--max-results','1')['jobSummaries'][0];assert base['status']=='SUCCEED'
job=aws('amplify','get-job','--app-id',a['appId'],'--branch-name',a['branchName'],'--job-id',base['jobId'])['job'];urls=[s['artifactsUrl'] for s in job['steps'] if s.get('artifactsUrl')];assert urls
try:raw=urllib.request.urlopen(urls[-1],timeout=55).read()
except urllib.error.HTTPError as e:
 if e.code!=404:raise
 receipt=json.loads((R/'docs/application-legal-auth-fix-344.json').read_text());assert receipt['jobId']==base['jobId'] and receipt['status']=='PUBLISHED_VERIFIED' and receipt['allOtherHostedFilesPreserved']
 archived=zipfile.ZipFile('/private/tmp/customer-legal-344/hosting-legal-344.zip');file=receipt['changedFile'];current=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+file+'?audit352='+base['jobId'],timeout=55).read();assert hashlib.sha256(current).hexdigest()==receipt['sha256']
 buf=io.BytesIO()
 with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
  for info in archived.infolist():z.writestr(copy.copy(info),current if info.filename==file else archived.read(info.filename))
 raw=buf.getvalue()
 print('Recovered exact latest hosting from verified job '+base['jobId']+' archive chain',flush=True)
(O/'before.zip').write_bytes(raw);old=zipfile.ZipFile(io.BytesIO(raw));changes={};diffs=[]
for file in ['merchant-payouts.js','merchant-financial-account.js','pages/finance.html']:
 live=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+file+'?before352='+base['jobId'],timeout=55).read();assert live==old.read(file),'HOSTING_BASE_DRIFT '+file

for file in ['merchant-payouts.js','merchant-financial-account.js','settlement-statement-details.js','settlement-statements.js']:
 head=subprocess.check_output(['git','show','HEAD:frontend/'+file],cwd=R);live=old.read(file)
 if head!=live:
  diff=''.join(difflib.unified_diff(head.decode().splitlines(True),live.decode().splitlines(True),fromfile=file+' HEAD',tofile=file+' live'));(O/(file+'.base.diff')).write_text(diff);print('BASE_DRIFT',file,'diff lines',len(diff.splitlines()),flush=True);raise RuntimeError('Review live drift before preparing overlay')
 changes[file]=(R/'frontend'/file).read_bytes()
changes['merchant-corrections.js']=(R/'frontend/merchant-corrections.js').read_bytes()
page=old.read('pages/finance.html').decode();pattern=r'<script src="\.\./merchant-payouts\.js[^"\n]*"></script>';assert len(re.findall(pattern,page))==1
page=re.sub(pattern,'<script src="../merchant-corrections.js?v=352"></script>\n<script src="../merchant-payouts.js?v=352"></script>',page);pattern=r'<script src="\.\./merchant-financial-account\.js[^"\n]*"></script>';assert len(re.findall(pattern,page))==1;page=re.sub(pattern,'<script src="../merchant-financial-account.js?v=352"></script>',page);
for file in ['settlement-statement-details.js','settlement-statements.js']:
 pattern=r'<script src="\.\./'+re.escape(file)+r'[^"\n]*"></script>';assert len(re.findall(pattern,page))==1;page=re.sub(pattern,'<script src="../'+file+'?v=352"></script>',page)
changes['pages/finance.html']=page.encode()
for file,data in changes.items():
 p=O/'check'/file;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 if file.endswith('.js'):subprocess.run(['node','--check',str(p)],check=True)
 if file in old.namelist():diffs.append(''.join(difflib.unified_diff(old.read(file).decode().splitlines(True),data.decode().splitlines(True),fromfile=file+' live',tofile=file+' candidate')))
(O/'review.diff').write_text(''.join(diffs));candidate=O/'candidate.zip'
with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as z:
 for info in old.infolist():z.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
 for file,data in changes.items():
  if file not in old.namelist():z.writestr(file,data)
with zipfile.ZipFile(candidate) as z:assert all(z.read(k)==old.read(k) for k in old.namelist() if k not in changes)
(O/'manifest.json').write_text(json.dumps({'baseJob':base['jobId'],'candidateSha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),'changedFiles':list(changes),'sourceHashes':{f:hashlib.sha256(v).hexdigest() for f,v in changes.items()},'otherEntriesPreserved':True},indent=2));print('Hosting overlay prepared; base job',base['jobId'],'files',list(changes))
