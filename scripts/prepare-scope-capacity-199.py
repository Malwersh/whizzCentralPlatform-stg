"""Prepare code-only capacity for one additional exact staging test scope; keep all existing scopes."""
import boto3,json,pathlib,subprocess,urllib.request,zipfile,re,concurrent.futures,hashlib,base64
p=pathlib.Path('/private/tmp/scope-capacity-199');p.mkdir(mode=0o700,exist_ok=True);s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');names=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./scripts/check-finance-rollout-deployment.cjs').FUNCTIONS))"]))
def prepare(n):
 f=l.get_function(FunctionName=n);c=f['Configuration'];(p/(n+'.config.private.json')).write_text(json.dumps(c,default=str));raw=urllib.request.urlopen(f['Code']['Location'],timeout=90).read();(p/(n+'.original.zip')).write_bytes(raw);changes=[]
 with zipfile.ZipFile(p/(n+'.original.zip')) as z,zipfile.ZipFile(p/(n+'.candidate.zip'),'w',zipfile.ZIP_DEFLATED) as out:
  for e in z.infolist():
   b=z.read(e.filename)
   if e.filename.endswith('.js') and not e.filename.startswith('node_modules/') and b'FINANCE_ROLLOUT_NOT_CONFIGURED' in b:
    t=b.decode();t,count=re.subn(r'(\b\w+\.scopes\.length\s*>\s*)4\b',r'\g<1>5',t)
    if count:changes.append({'file':e.filename,'replacements':count});b=t.encode()
   out.writestr(e,b)
 assert changes,'MISSING_READER '+n
 return {'name':n,'revisionId':c['RevisionId'],'baseSha':c['CodeSha256'],'candidateSha':base64.b64encode(hashlib.sha256((p/(n+'.candidate.zip')).read_bytes()).digest()).decode(),'changes':changes}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 rows=list(pool.map(prepare,names))
(p/'manifest.json').write_text(json.dumps(rows,indent=2));print(json.dumps(rows),flush=True)
