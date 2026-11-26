"""Publish recipient display only to existing financial/wave bundles; no financial writes or IAM."""
import pathlib,zipfile,io,copy,subprocess,json,boto3,hashlib,base64,concurrent.futures,sys
p=pathlib.Path('/private/tmp/driver-offer-167');names=['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept']
if '--apply' not in sys.argv:
 for n in names:
  z=zipfile.ZipFile(p/(n+'.original.zip'));changes={}
  for f in z.namelist():
   if f.endswith('.js') and '/' not in f and b'function driverOfferDisplay(saved)' in z.read(f):
    old=p/(n+'.'+f+'.old');new=p/(n+'.'+f+'.new.cjs');old.write_bytes(z.read(f));subprocess.run(['node','scripts/overlay-driver-recipient-167.cjs',str(old),str(new)],check=True);subprocess.run(['node','--check',str(new)],check=True);changes[f]=new.read_bytes()
  assert changes
  out=io.BytesIO()
  with zipfile.ZipFile(out,'w') as dest:
   for item in z.infolist():dest.writestr(copy.copy(item),changes.get(item.filename,z.read(item.filename)))
  check=zipfile.ZipFile(io.BytesIO(out.getvalue()));assert all(check.read(f)==z.read(f) for f in z.namelist() if f not in changes);(p/(n+'.fixed.zip')).write_bytes(out.getvalue());print(n,list(changes),flush=True)
 sys.exit()
l=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda');receipt={'functions':[],'newIam':False,'financialAmountsChanged':False,'recipientFields':['name','address'],'phoneExcluded':True}
def deploy(n):
 c=json.loads((p/(n+'.config.private.json')).read_text());before=l.get_function_configuration(FunctionName=n);assert before['RevisionId']==c['RevisionId'];b=(p/(n+'.fixed.zip')).read_bytes();l.update_function_code(FunctionName=n,RevisionId=c['RevisionId'],ZipFile=b);l.get_waiter('function_updated_v2').wait(FunctionName=n,WaiterConfig={'Delay':2,'MaxAttempts':90});after=l.get_function_configuration(FunctionName=n);assert after['Role']==c['Role'] and after['Environment']==c['Environment'];assert after['CodeSha256']==base64.b64encode(hashlib.sha256(b).digest()).decode();print(n,'VERIFIED',flush=True);return {'name':n,'codeSha256':after['CodeSha256'],'configurationPreserved':True}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:receipt['functions']=list(pool.map(deploy,names))
pathlib.Path('docs/driver-offer-recipient-display-167.json').write_text(json.dumps(receipt,indent=2)+'\n')
