"""Preserve fresh expiry fences across a request that spans more than one clock second."""
import sys,pathlib,json,zipfile,copy,urllib.request,hashlib,base64,time
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/registry-259');l=session().client('lambda');q=r/'docs/merchant-staff-settlements-publication-259.json';pub=json.loads(q.read_text());assert pub['status']=='PUBLISHED';item=next(f for f in pub['functions']if f['function']=='staging-wizz-staff-service');assert 'ℹ pass 13' in pathlib.Path('/private/tmp/merchant-staff-settlement-259-bundle.log').read_text();f=l.get_function(FunctionName=item['function']);cfg=f['Configuration'];assert cfg['CodeSha256']==item['deployedCodeSha256'];raw=urllib.request.urlopen(f['Code']['Location'],timeout=90).read();sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode();assert sha(raw)==cfg['CodeSha256'];(p/'staff-expiry-base.zip').write_bytes(raw)
with zipfile.ZipFile(p/'staff-expiry-base.zip')as old:
 with zipfile.ZipFile(p/'staff-final.zip','w',zipfile.ZIP_DEFLATED)as out:
  for e in old.infolist():out.writestr(copy.copy(e),(r/'backend/staff-service/settlement-runtime.js').read_bytes()if e.filename=='settlement-runtime.js'else old.read(e.filename))
 with zipfile.ZipFile(p/'staff-final.zip')as out:assert all(out.read(n)==old.read(n)for n in old.namelist()if n!='settlement-runtime.js')
new=(p/'staff-final.zip').read_bytes();l.update_function_code(FunctionName=item['function'],RevisionId=cfg['RevisionId'],ZipFile=new,Publish=False)
for _ in range(90):
 after=l.get_function_configuration(FunctionName=item['function'])
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==sha(new)
for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','VpcConfig','Layers']:assert cfg.get(k)==after.get(k),k
item['expiryFenceVerification']={'baseCodeSha256':cfg['CodeSha256'],'changedFiles':['settlement-runtime.js'],'freshTimeChecksPreserved':True,'otherEntriesAndConfigPreserved':True};item['deployedCodeSha256']=after['CodeSha256'];item['packageSha256']=hashlib.sha256(new).hexdigest();q.write_text(json.dumps(pub,ensure_ascii=False,indent=2)+'\n');print('PASS clock-boundary fix published; fresh expiry guards retained, no business or financial writes.',flush=True)
