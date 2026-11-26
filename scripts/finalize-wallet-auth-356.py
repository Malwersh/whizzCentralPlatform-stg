from pathlib import Path
import json,subprocess,urllib.request,zipfile,io,copy,hashlib,base64,time
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/wallet-auth-356';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
assert 'pass 69' in Path('/tmp/auth356-unit.log').read_text();dest=R/'docs/wallet-authorization-publication-356.json';r=json.loads(dest.read_text());assert r['status']=='PUBLISHED_STAGING_VERIFIED_POSITIVE_SIGNUP_ACCEPTANCE_QUEUED'
for m in r['functions']:
 f=aws('lambda','get-function','--function-name',m['name']);c=f['Configuration'];assert c['CodeSha256']==m['sha256'];raw=urllib.request.urlopen(f['Code']['Location'],timeout=55).read();assert sha(raw)==m['sha256'];(P/(m['name']+'-pre-strict-input.zip')).write_bytes(raw);z=zipfile.ZipFile(io.BytesIO(raw));changes={'dist/walletCreationAuth'+ext:(R/'backend/wallet-service/dist'/('walletCreationAuth'+ext)).read_bytes() for ext in ['.js','.js.map']};candidate=P/(m['name']+'-strict-input.zip')
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 with zipfile.ZipFile(candidate) as out:assert all(out.read(k)==z.read(k) for k in z.namelist() if k not in changes)
 aws('lambda','update-function-code','--function-name',m['name'],'--revision-id',c['RevisionId'],'--zip-file','fileb://'+str(candidate))
 for _ in range(90):
  v=aws('lambda','get-function-configuration','--function-name',m['name'])
  if v['LastUpdateStatus']=='Successful':break
  assert v['LastUpdateStatus']!='Failed';time.sleep(1)
 else:raise RuntimeError('Update pending')
 assert v['CodeSha256']==sha(candidate.read_bytes()) and v['Environment']==c['Environment'];m['sha256']=v['CodeSha256'];m['strictInputTypesVerified']=True;dest.write_text(json.dumps(r,indent=2)+'\n');print('Verified final strict-input helper',m['name'],flush=True)
subprocess.run(B+['apigateway','get-export','--rest-api-id','z14s5f8oxh','--stage-name','staging','--export-type','oas30','--parameters','extensions=integrations',str(P/'api-deployed-after.private.json')],check=True,stdout=subprocess.DEVNULL)
a=json.loads((P/'api-deployed-before.private.json').read_text());b=json.loads((P/'api-deployed-after.private.json').read_text());assert b['paths']['/wallet/create']['post']['security']==[{'sigv4':[]}];b['paths']['/wallet/create']['post'].pop('security');b.get('components',{}).get('securitySchemes',{}).pop('sigv4',None);assert a==b,'Unrelated deployed API change';r['api']['unrelatedDeployedMethodsPreserved']=True;r['tests']={'node':69,'authorizer':16};dest.write_text(json.dumps(r,indent=2)+'\n');print('PASS only deployed API security delta is wallet/create IAM requirement')
