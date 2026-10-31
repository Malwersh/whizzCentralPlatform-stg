from pathlib import Path
import json,subprocess,urllib.request,urllib.error,zipfile,io,copy,hashlib
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/home-layout-361';H=P/'hosting';H.mkdir(exist_ok=True);B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m';base='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def aws(*args):return json.loads(subprocess.check_output(B+list(args)+['--output','json']))
def sha(b):return hashlib.sha256(b).hexdigest()
j=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert j['status']=='SUCCEED'
steps=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',j['jobId'])['job']['steps'];url=[v['artifactsUrl'] for v in steps if v.get('artifactsUrl')][-1]
try:raw=urllib.request.urlopen(url,timeout=45).read()
except urllib.error.HTTPError as e:
 if e.code!=404:raise
 old=json.loads((R/'docs/audit-trail-publication-358.json').read_text())['hosting'];assert old['jobId']==j['jobId'];raw=(R/'backend/.tmp/audit-trail-358/hosting/candidate.zip').read_bytes()
 z=zipfile.ZipFile(io.BytesIO(raw));assert all(sha(z.read(f))==digest for f,digest in old['sourceHashes'].items())
z=zipfile.ZipFile(io.BytesIO(raw));(H/'before.zip').write_bytes(raw);changes={f:(R/'frontend'/f).read_bytes() for f in ['home-layout.js','pages/home-layout.html']}
s=z.read('pages/promotions.html');assert urllib.request.urlopen(base+'pages/promotions.html?layout361base='+j['jobId'],timeout=45).read()==s
s=s.decode();i=s.index('<body');i=s.index('>',i)+1;s=s[:i]+'\n<div style="padding:12px 24px;text-align:end"><a href="home-layout.html" style="color:#00296b">إدارة أقسام الرئيسية في تطبيق الزبون ←</a></div>'+s[i:];changes['pages/promotions.html']=s.encode()
with zipfile.ZipFile(H/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 for f,data in changes.items():
  if f not in z.namelist():out.writestr(f,data)
with zipfile.ZipFile(H/'candidate.zip') as out:assert all(out.read(f)==z.read(f) for f in z.namelist() if f not in changes)
(H/'manifest.json').write_text(json.dumps({'baseJob':j['jobId'],'candidateSha256':sha((H/'candidate.zip').read_bytes()),'sourceHashes':{f:sha(v) for f,v in changes.items()},'allOtherEntriesPreserved':True},indent=2));print('Prepared hosting overlay: 3 files; all unrelated live entries preserved',flush=True)
