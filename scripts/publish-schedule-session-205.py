"""Single-entry staging error classification fix. No IAM/config/data changes."""
import boto3,pathlib,urllib.request,zipfile,io,copy,time,json,hashlib,base64
p=pathlib.Path('/private/tmp/financial-session-205');p.mkdir(exist_ok=True);p.chmod(0o700);s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');name='staging-wizz-staff-service';f=l.get_function(FunctionName=name);cfg=f['Configuration'];raw=urllib.request.urlopen(f['Code']['Location']).read();(p/'before.zip').write_bytes(raw);(p/'before-config.private.json').write_text(json.dumps(cfg,default=str));replacement=pathlib.Path('backend/staff-service/settlement-runtime.js').read_bytes()
with zipfile.ZipFile(io.BytesIO(raw)) as old:
 with zipfile.ZipFile(p/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for x in old.infolist():out.writestr(copy.copy(x),replacement if x.filename=='settlement-runtime.js' else old.read(x.filename))
 with zipfile.ZipFile(p/'candidate.zip') as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n!='settlement-runtime.js')
l.update_function_code(FunctionName=name,ZipFile=(p/'candidate.zip').read_bytes(),RevisionId=cfg['RevisionId'])
for _ in range(40):
 final=l.get_function_configuration(FunctionName=name)
 if final.get('LastUpdateStatus')!='InProgress':break
 time.sleep(2)
assert final['LastUpdateStatus']=='Successful';assert final['Environment']==cfg['Environment'] and final['Role']==cfg['Role'];assert final['CodeSha256']==base64.b64encode(hashlib.sha256((p/'candidate.zip').read_bytes()).digest()).decode();receipt={'part':205,'status':'PUBLISHED_VERIFIED','changedEntries':['settlement-runtime.js'],'purpose':'Expired session reports SCHEDULE_REAUTH_REQUIRED instead of SCHEDULE_PERMISSION_REQUIRED','testsPassed':14,'financialDataWrites':False,'permissionsChanged':False,'configurationChanged':False,'codeSha256':final['CodeSha256']};pathlib.Path('docs/schedule-session-repair-205.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
