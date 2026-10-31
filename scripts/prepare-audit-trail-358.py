from pathlib import Path
import json,subprocess,urllib.request,urllib.error,zipfile,io,copy,hashlib,base64,re
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/audit-trail-358';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m';base='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def aws(*a):return json.loads(subprocess.check_output(B+list(a)+['--output','json']))
def sha(b):return hashlib.sha256(b).hexdigest()
c=json.loads((P/'config.private.json').read_text());current=aws('lambda','get-function-configuration','--function-name',c['FunctionName']);assert current['RevisionId']==c['RevisionId'] and current['CodeSha256']==c['CodeSha256'];raw=(P/'before.zip').read_bytes();assert base64.b64encode(hashlib.sha256(raw).digest()).decode()==c['CodeSha256'];z=zipfile.ZipFile(io.BytesIO(raw));changes={'_discount_review/central-staff/index.js':(P/'candidate-central.js').read_bytes(),'audit-trail-358.js':(R/'backend/staff-service/audit-trail.js').read_bytes()}
with zipfile.ZipFile(P/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 for f,data in changes.items():
  if f not in z.namelist():out.writestr(f,data)
with zipfile.ZipFile(P/'candidate.zip') as out:assert all(out.read(f)==z.read(f) for f in z.namelist() if f not in changes)
(P/'backend-manifest.json').write_text(json.dumps({'name':c['FunctionName'],'revisionId':c['RevisionId'],'beforeSha256':c['CodeSha256'],'candidateSha256':base64.b64encode(hashlib.sha256((P/'candidate.zip').read_bytes()).digest()).decode(),'changedFiles':list(changes),'allOtherEntriesPreserved':True},indent=2))
H=P/'hosting';H.mkdir(exist_ok=True);j=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert j['status']=='SUCCEED';steps=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',j['jobId'])['job']['steps'];url=[v['artifactsUrl'] for v in steps if v.get('artifactsUrl')][-1]
try:raw=urllib.request.urlopen(url,timeout=55).read()
except urllib.error.HTTPError as e:
 if e.code!=404:raise
 old=json.loads((R/'docs/wallet-operating-limits-publication-355.json').read_text())['hosting'];assert old['jobId']==j['jobId'];raw=(R/'backend/.tmp/wallet-limits-355/hosting/candidate.zip').read_bytes();oldz=zipfile.ZipFile(io.BytesIO(raw));assert all(sha(oldz.read(f))==digest for f,digest in old['sourceHashes'].items())
z=zipfile.ZipFile(io.BytesIO(raw));(H/'before.zip').write_bytes(raw);changes={f:(R/'frontend'/f).read_bytes() for f in ['audit-trail.js','pages/audit-trail.html']}
# Apply small exact patches to the published source, preserving any unrelated live fixes.
s=z.read('staff.js').decode();assert urllib.request.urlopen(base+'staff.js?base358='+j['jobId'],timeout=55).read()==s.encode();a=s.index("el('audit-load').onclick=");b=s.index("\nel('reload')",a);changes['staff.js']=(s[:a]+"el('audit-load').onclick=()=>{window.location.href='audit-trail.html';};"+s[b:]).encode()
s=z.read('assets/js/rbac.js').decode();assert s.count("'staff.html':'staff.read',")==1;s=s.replace("'staff.html':'staff.read',","'staff.html':'staff.read','audit-trail.html':'audit.read',");assert s.count("?'staff.html':this.staff.permissions.includes('finance.read')")==1;s=s.replace("?'staff.html':this.staff.permissions.includes('finance.read')","?'staff.html':this.staff.permissions.includes('audit.read')?'audit-trail.html':this.staff.permissions.includes('finance.read')");changes['assets/js/rbac.js']=s.encode()
s=z.read('assets/js/login.js').decode();needle="    if(profile.permissions.includes('staff.read'))return prefix+'staff.html';";assert s.count(needle)==1;changes['assets/js/login.js']=s.replace(needle,needle+"\n    if(profile.permissions.includes('audit.read'))return prefix+'audit-trail.html';").encode()
for f in z.namelist():
 if f.endswith('.html'):
  s=z.read(f).decode();v=re.sub(r'((?:\.\./)?assets/js/(?:rbac|login)\.js)(?:\?[^"\s<>]*)?',r'\1?v=358',s)
  if f=='pages/staff.html':v=re.sub(r'(\.\./staff\.js)(?:\?[^"\s<>]*)?',r'\1?v=358',v)
  if v!=s:changes[f]=v.encode()
for f,data in changes.items():
 p=H/'check'/f;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 if f.endswith('.js'):subprocess.run(['node','--check',str(p)],check=True)
with zipfile.ZipFile(H/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 for f,data in changes.items():
  if f not in z.namelist():out.writestr(f,data)
with zipfile.ZipFile(H/'candidate.zip') as out:assert all(out.read(f)==z.read(f) for f in z.namelist() if f not in changes)
(H/'manifest.json').write_text(json.dumps({'baseJob':j['jobId'],'candidateSha256':sha((H/'candidate.zip').read_bytes()),'changedFiles':list(changes),'sourceHashes':{f:sha(b) for f,b in changes.items()},'allOtherEntriesPreserved':True},indent=2));print('Prepared backend 2-file delta and hosting overlay',len(changes),'files including HTML cache references; unrelated entries preserved')
