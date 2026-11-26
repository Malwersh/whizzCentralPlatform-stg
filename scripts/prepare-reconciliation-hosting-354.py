"""Prepare a five-file UI delta from verified latest hosting, no publication."""
from pathlib import Path
import json,subprocess,urllib.request,urllib.error,zipfile,io,copy,hashlib,re
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/reconciliation-354/hosting';P.mkdir(exist_ok=True,parents=True);B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m';base='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def aws(*a):return json.loads(subprocess.check_output(B+list(a)+['--output','json']))
def sha(x):return hashlib.sha256(x).hexdigest()
def fetchurl(url,timeout=55):
 for attempt in range(3):
  try:return urllib.request.urlopen(url,timeout=timeout)
  except urllib.error.HTTPError:raise
  except (urllib.error.URLError,TimeoutError):
   if attempt==2:raise
   print('Retrying read-only hosting download',flush=True)

j=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert j['status']=='SUCCEED'
steps=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',j['jobId'])['job']['steps'];url=[x['artifactsUrl'] for x in steps if x.get('artifactsUrl')][-1]
try:raw=fetchurl(url,timeout=55).read()
except urllib.error.HTTPError as e:
 if e.code!=404:raise
 previous=json.loads((R/'docs/post-payout-correction-publication-353.json').read_text());assert previous['hosting']['jobId']==j['jobId'] and previous['hosting']['unrelatedEntriesPreserved'];raw=(R/'backend/.tmp/post-payout-353/hosting/candidate.zip').read_bytes();assert sha(raw)==json.loads((R/'backend/.tmp/post-payout-353/hosting/manifest.json').read_text())['candidateSha256']
(P/'before.zip').write_bytes(raw);old=zipfile.ZipFile(io.BytesIO(raw));changes={}
for f in ['finance.js','company-accounts.js','pages/finance.html','pages/financial-management.html']:
 assert fetchurl(base+f+'?before354='+j['jobId'],timeout=55).read()==old.read(f),'LIVE_DRIFT '+f
 if f.endswith('.js'):changes[f]=(R/'frontend'/f).read_bytes()
for f in ['finance.js','company-accounts.js']:
 
 if f=='finance.js':assert subprocess.check_output(['git','show','HEAD:frontend/'+f],cwd=R)==old.read(f),'JS_BASE_DRIFT '+f
 else:
  baseLines=subprocess.check_output(['git','show','HEAD:frontend/'+f],cwd=R).decode().splitlines(True);liveLines=old.read(f).decode().splitlines(True);import difflib
  delta=[op for op in difflib.SequenceMatcher(None,baseLines,liveLines,autojunk=False).get_opcodes() if op[0]!='equal'];assert len(delta)==2
  for tag,begin,end,k,l in delta:assert tag=='replace' and ''.join(baseLines[begin:end]).startswith(('async function api','async function init')) and ''.join(liveLines[k:l]) in changes[f].decode(),'UNREVIEWED_LIVE_CHANGE'
finance=old.read('pages/finance.html').decode();needle='<th>صافي القيود</th><th>الفرق</th></tr></thead><tbody id="reconcile-balances">';assert finance.count(needle)==1;finance=finance.replace(needle,'<th>صافي القيود المصنفة</th><th>الفرق</th><th>نتيجة التحقق</th></tr></thead><tbody id="reconcile-balances">')
for file,text in [('finance.js',finance),('company-accounts.js',old.read('pages/financial-management.html').decode())]:
 pattern=r'(<script src="\.\./'+re.escape(file)+r')(?:\?[^"\n]*)?(\"></script>)';assert len(re.findall(pattern,text))==1;page=re.sub(pattern,r'\1?v=354\2',text);changes['pages/finance.html' if file=='finance.js' else 'pages/financial-management.html']=page.encode()
for f,data in changes.items():
 p=P/'check'/f;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 if f.endswith('.js'):subprocess.run(['node','--check',str(p)],check=True)
with zipfile.ZipFile(P/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
 for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
with zipfile.ZipFile(P/'candidate.zip') as out:assert all(out.read(f)==old.read(f) for f in old.namelist() if f not in changes)
(P/'manifest.json').write_text(json.dumps({'baseJob':j['jobId'],'candidateSha256':sha((P/'candidate.zip').read_bytes()),'changedFiles':list(changes),'sourceHashes':{f:sha(b) for f,b in changes.items()},'otherEntriesPreserved':True},indent=2));print('Prepared hosting delta on job',j['jobId'])
