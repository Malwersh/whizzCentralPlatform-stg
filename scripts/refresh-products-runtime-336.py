"""Apply reviewed follow-up inventory changes to release-336 functions with drift checks."""
from pathlib import Path
import boto3,json,zipfile,base64,hashlib,shutil,io,subprocess
R=Path(__file__).resolve().parents[1];O=Path('/private/tmp/products-336-release');subprocess.run(['node',str(R/'scripts/build-products-runtime-336.cjs')],cwd=R,check=True)
state=json.loads((O/'publication.json').read_text());assert state['complete'];l=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda')
for name in ['order-receiver-regional-staging-product-management-v4-sam','WizzUser-CreateOrder-staging','staging-merchant-inventory-336']:
 c=l.get_function_configuration(FunctionName=name);entry=next((e for e in state['functions'] if e['name']==name),None);expected=entry['afterSha256'] if entry else state['workerSha256'];assert c['CodeSha256']==expected,'LIVE_DRIFT '+name
 if name=='staging-merchant-inventory-336':
  stream=io.BytesIO()
  with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as z:z.write(O/'candidates/inventory-worker.js','index.js')
  data=stream.getvalue()
 else:
  package=O/name/'package'
  if name.startswith('order-receiver-'):shutil.copy2(O/'candidates/merchant-products.js',package/'product_management_handler.js')
  else:
   source=R.parent/'wizzuser-stg/backend/src/functions/create-order';dest=package/'functions/create-order'
   for f in source.rglob('*.js'):p=dest/f.relative_to(source);p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,p)
  candidate=O/name/'candidate-final-336.zip'
  with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as z:
   for f in sorted(package.rglob('*')):
    if f.is_file():z.write(f,str(f.relative_to(package)))
  data=candidate.read_bytes()
 l.update_function_code(FunctionName=name,RevisionId=c['RevisionId'],ZipFile=data);l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':1,'MaxAttempts':90});digest=base64.b64encode(hashlib.sha256(data).digest()).decode();assert l.get_function_configuration(FunctionName=name)['CodeSha256']==digest
 if entry:entry['afterSha256']=digest
 else:state['workerSha256']=digest
 (O/'publication.json').write_text(json.dumps(state,indent=2));print('Published verified final inventory integration:',name,flush=True)
