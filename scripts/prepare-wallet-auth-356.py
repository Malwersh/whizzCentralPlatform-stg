from pathlib import Path
import json,zipfile,copy,io,hashlib,base64,difflib,subprocess,concurrent.futures
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/wallet-auth-356';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):return json.loads(subprocess.check_output(B+list(a)+['--output','json']))
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
assert 'fail 0' in Path('/tmp/auth356-unit.log').read_text();assert not Path('/tmp/auth356-tsc.log').read_text().strip()
# Exclude unrelated pending API changes before creating a new stage deployment.
deployed=json.loads((P/'api-deployed-before.private.json').read_text());resources=json.loads((P/'resources.private.json').read_text())['items'];auths=aws('apigateway','get-authorizers','--rest-api-id','z14s5f8oxh')['items'];authNames={v['id']:v['name'] for v in auths};jobs=[(r,m) for r in resources for m in r.get('resourceMethods',{})]
def check(pair):
 r,m=pair;v=aws('apigateway','get-method','--rest-api-id','z14s5f8oxh','--resource-id',r['id'],'--http-method',m);old=deployed['paths'][r['path']].get(m.lower(),deployed['paths'][r['path']].get('x-amazon-apigateway-any-method'));assert old is not None,(r['path'],m,'undeployed route')
 security=old.get('security',deployed.get('security',[]));expected=[] if v['authorizationType']=='NONE' else [{authNames[v['authorizerId']]:[]}] if v['authorizationType']=='CUSTOM' else [{'sigv4':[]}];assert security==expected,(r['path'],m,'authorization drift',security,expected)
 a=old.get('x-amazon-apigateway-integration',{});b=v.get('methodIntegration',{})
 for k in ['type','httpMethod','uri','credentials','connectionType','requestTemplates','requestParameters','passthroughBehavior','cacheKeyParameters','contentHandling','timeoutInMillis']:
  av=a.get(k);bv=b.get(k)
  if k in ['type','passthroughBehavior']:av=str(av).lower();bv=str(bv).lower()
  if k=='timeoutInMillis':av=29000 if av is None else av;bv=29000 if bv is None else bv
  if k=='connectionType':av=av or 'INTERNET';bv=bv or 'INTERNET'
  if k in ['requestTemplates','requestParameters']:av=av or {};bv=bv or {}
  if k=='cacheKeyParameters':av=av or [];bv=bv or []
  assert av==bv,(r['path'],m,k,'integration drift',av,bv)
 return {'path':r['path'],'method':m,'auth':v['authorizationType']}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:proof=list(pool.map(check,jobs))
(P/'api-parity-proof.json').write_text(json.dumps(proof,indent=2));print('Verified deployed/current API parity',len(proof),'methods',flush=True)
manifest=[]
for name,mods in [('staging-wizz-wallet-service',['index','walletCreationAuth']),('staging-wizz-wallet-creation-trigger',['cognitoTrigger','walletCreationAuth'])]:
 c=json.loads((P/(name+'-config.private.json')).read_text());live=aws('lambda','get-function-configuration','--function-name',name);assert live['RevisionId']==c['RevisionId'] and live['CodeSha256']==c['CodeSha256'];raw=(P/(name+'-before.zip')).read_bytes();assert sha(raw)==c['CodeSha256'];z=zipfile.ZipFile(io.BytesIO(raw));changes={}
 for module in mods:
  for ext in ['.js','.js.map']:changes['dist/'+module+ext]=(R/'backend/wallet-service/dist'/(module+ext)).read_bytes()
 if name.endswith('service'):
  old=z.read('dist/index.js').decode();new=changes['dist/index.js'].decode();delta=list(difflib.unified_diff(old.splitlines(True),new.splitlines(True)));(P/'index-diff.private.txt').write_text(''.join(delta));assert sum(x.startswith('@@') for x in delta)==3
 candidate=P/(name+'-candidate.zip')
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for f,data in changes.items():
   if f not in z.namelist():out.writestr(f,data)
 with zipfile.ZipFile(candidate) as out:assert all(out.read(f)==z.read(f) for f in z.namelist() if f not in changes)
 manifest.append({'name':name,'beforeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'candidate':str(candidate),'candidateSha256':sha(candidate.read_bytes()),'changedFiles':list(changes),'otherEntriesPreserved':True})
(P/'manifest.private.json').write_text(json.dumps(manifest,indent=2));print('Prepared two minimal function packages; no AWS mutations')
