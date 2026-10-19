from pathlib import Path
import importlib.util,json,io,zipfile,hashlib,base64
R=Path(__file__).resolve().parents[1];O=Path('/private/tmp/notification100');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);l=m.session().client('lambda');proof=json.loads((O/'publication.json').read_text());replacement=(R.parent/'whizzMerchants-stg/backend/functions/shared/notification-sound-policy.js').read_bytes()
for row in proof['functions']:
 if row['name'] not in ['order-receiver-merchant-orders-staging-v1','order-receiver-regional-staging-unified-auth-v4-sam']:continue
 name=row['name'];old=(O/(name+'.candidate.zip')).read_bytes();assert base64.b64encode(hashlib.sha256(old).digest()).decode()==row['sha256'];cfg=l.get_function_configuration(FunctionName=name);assert cfg['CodeSha256']==row['sha256'];buf=io.BytesIO()
 with zipfile.ZipFile(io.BytesIO(old)) as z,zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as new:
  for n in z.namelist():new.writestr(n,replacement if n=='shared/notification-sound-policy.js' else z.read(n))
 payload=buf.getvalue();l.update_function_code(FunctionName=name,RevisionId=cfg['RevisionId'],ZipFile=payload);l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':1,'MaxAttempts':90});now=l.get_function_configuration(FunctionName=name);sha=base64.b64encode(hashlib.sha256(payload).digest()).decode();assert now['CodeSha256']==sha
 for k in ['Environment','Role','Runtime','Handler','Timeout','Layers','Architectures']:assert now.get(k)==cfg.get(k)
 row['sha256']=sha;(O/(name+'.candidate.zip')).write_bytes(payload);(O/'publication.json').write_text(json.dumps(proof,indent=2));print(json.dumps({'originalFallbackPublished':name}),flush=True)
