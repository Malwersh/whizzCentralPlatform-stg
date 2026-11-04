from pathlib import Path
import json,subprocess,urllib.request,urllib.error,zipfile,io,copy,hashlib
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/wallet-limits-355/hosting';P.mkdir(parents=True,exist_ok=True);B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m';base='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def aws(*a):return json.loads(subprocess.check_output(B+list(a)+['--output','json']))
def sha(b):return hashlib.sha256(b).hexdigest()
j=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert j['status']=='SUCCEED'
steps=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',j['jobId'])['job']['steps'];url=[x['artifactsUrl'] for x in steps if x.get('artifactsUrl')][-1]
try:raw=urllib.request.urlopen(url,timeout=55).read()
except urllib.error.HTTPError as e:
 if e.code!=404:raise
 h=json.loads((R/'docs/reconciliation-publication-354.json').read_text())['hosting'];assert h['jobId']==j['jobId'];raw=(R/'backend/.tmp/reconciliation-354/hosting/legacy-display-candidate.zip').read_bytes()
 z=zipfile.ZipFile(io.BytesIO(raw));assert all(sha(z.read(f))==digest for f,digest in h['sourceHashes'].items())
z=zipfile.ZipFile(io.BytesIO(raw));page=z.read('pages/finance.html');assert urllib.request.urlopen(base+'pages/finance.html?base355='+j['jobId'],timeout=55).read()==page
needle=b'<script src="../finance-workspace.js';assert page.count(needle)==1 and b'wallet-operating-limits.js' not in page
changes={'pages/finance.html':page.replace(needle,b'<script src="../wallet-operating-limits.js?v=355"></script>'+needle),'wallet-operating-limits.js':(R/'frontend/wallet-operating-limits.js').read_bytes()}
(P/'before.zip').write_bytes(raw)
for f,data in changes.items():p=P/'check'/f;p.parent.mkdir(exist_ok=True,parents=True);p.write_bytes(data)
with zipfile.ZipFile(P/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 for f,data in changes.items():
  if f not in z.namelist():out.writestr(f,data)
with zipfile.ZipFile(P/'candidate.zip') as out:assert all(out.read(f)==z.read(f) for f in z.namelist() if f not in changes)
(P/'manifest.json').write_text(json.dumps({'baseJob':j['jobId'],'candidateSha256':sha((P/'candidate.zip').read_bytes()),'changedFiles':list(changes),'sourceHashes':{f:sha(v) for f,v in changes.items()}},indent=2));print('Prepared two hosting files; all unrelated entries preserved')
