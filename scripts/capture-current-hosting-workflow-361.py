from pathlib import Path
import subprocess,json,urllib.request,urllib.error,zipfile,concurrent.futures,hashlib,io
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/home-layout-workflow-361';P.mkdir(parents=True,exist_ok=True);B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m';base='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def aws(*args):return json.loads(subprocess.check_output(B+list(args)+['--output','json']))
def sha(b):return hashlib.sha256(b).hexdigest()
j=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert j['status']=='SUCCEED'
# Complete known deployment manifest plus every frontend path present in the colleague's latest source tree.
ref='db83e95c798193b06078b822ee838590e0348d1d';tree=json.loads(subprocess.check_output(['gh','api',f'repos/Malwersh/whizzCentralPlatform-stg/git/trees/{ref}?recursive=1']));assert not tree.get('truncated');old=zipfile.ZipFile(R/'backend/.tmp/home-layout-361/hosting/candidate.zip');known={name for name in old.namelist() if not name.endswith('/')};source=set(x['path'][9:] for x in tree['tree'] if x['type']=='blob' and x['path'].startswith('frontend/'));paths=sorted(known|source)
def capture(path):
 u=base+urllib.parse.quote(path)+'?capture361workflow='+j['jobId']
 try:
  r=urllib.request.urlopen(u,timeout=35);data=r.read();ctype=r.headers.get('Content-Type','')
  # SPA fallback must not turn absent static files into HTML copies.
  if not path.endswith(('.html','/','_redirects','_headers')) and 'text/html' in ctype and data.lstrip().startswith((b'<!',b'<html')):
   return path,None
  return path,data
 except urllib.error.HTTPError as e:
  if e.code==404:return path,None
  raise
rows={};missing=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
 for name,data in pool.map(capture,paths):
  if data is None:missing.append(name)
  else:rows[name]=data
print('Missing prior paths:',sorted(known-set(rows)),flush=True)
assert set(known)-set(rows)==set(), 'Previously deployed manifest has missing files; inspect before publication'
changes=[name for name in sorted(known) if rows[name]!=old.read(name)]
# Known upstream delta: GIF campaign UI only; stop if the current hosting contains unexplained changes.
assert set(changes)<=set(['campaign-image.js','home-slideshow.js','pages/promotions.html','commercial-management.js','pages/merchants.html']),changes
for name in ['campaign-image.js','home-slideshow.js']:
 remote=subprocess.check_output(['gh','api',f'repos/Malwersh/whizzCentralPlatform-stg/contents/frontend/{name}?ref={ref}','--jq','.content']);import base64
 assert rows[name]==base64.b64decode(remote), 'Upstream live bytes differ from source: '+name
latest=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId']==j['jobId'] and latest['status']=='SUCCEED'
with zipfile.ZipFile(P/'current-captured.zip','w',zipfile.ZIP_DEFLATED) as z:
 for name,data in rows.items():z.writestr(name,data)
proof={'jobId':j['jobId'],'capture':'Verified live files from complete prior deployment manifest plus latest colleague frontend source tree','sourceCommit':ref,'priorManifestCount':len(known),'sourceManifestCount':len(source),'capturedCount':len(rows),'addedPaths':sorted(set(rows)-known),'changedPriorPaths':changes,'sourceOnlyAbsentPaths':missing,'sha256':sha((P/'current-captured.zip').read_bytes()),'sourceHashes':{name:sha(data) for name,data in rows.items()}}
(P/'current-capture-proof.json').write_text(json.dumps(proof,indent=2));print('Captured live hosting',j['jobId'],'files',len(rows),'documented GIF delta',changes,'additional served files',len(set(rows)-known),flush=True)
