from pathlib import Path
import subprocess,json,urllib.request,zipfile,copy,hashlib,base64,os,re
R=Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';P=Path('/private/tmp/driver-timing-review-279');P.mkdir(exist_ok=True)
def aws(*a):return json.loads(subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']))
rows=[]
for label,name in [('financial','staging-driver-financial-accept'),('staff','staging-wizz-staff-service'),('driver','DriversApi-staging')]:
 f=aws('lambda','get-function','--function-name',name);cfg=f['Configuration'];private=P/(label+'-config.private.json');private.write_text(json.dumps(cfg));os.chmod(private,0o600)
 with urllib.request.urlopen(f['Code']['Location'],timeout=60)as response:data=response.read()
 assert base64.b64encode(hashlib.sha256(data).digest()).decode()==cfg['CodeSha256']
 (P/(label+'-base.zip')).write_bytes(data);old=zipfile.ZipFile(P/(label+'-base.zip'));changes={}
 if label=='financial':
  s=old.read('order-exception-runtime-229.js').decode();assert '// Timing review279:' not in s
  source=(R/'backend/shared/order-exception-runtime-229.js').read_text();s+='\n'+source[source.index('// Timing review279:'):];changes['order-exception-runtime-229.js']=s.encode();changes['driver-timing-review-runtime-279.js']=(R/'backend/shared/driver-timing-review-runtime-279.js').read_bytes()

  s=old.read('index.js').decode();needle='const allowed = [';a=s.index('async function financialAcceptanceHandler(');b=s.index(needle,a);changes['index.js']=(s[:b]+s[b:].replace(needle,needle+"'DRIVER_TIMING_REVIEW_CONFLICT','INVALID_DRIVER_TIMING_REVIEW','DRIVER_TIMING_ATTEMPT_UNAVAILABLE','DRIVER_TIMING_SOURCE_NOT_REVIEWABLE','DRIVER_TIMING_REVIEW_LIMIT','DRIVER_TIMING_APPEAL_OPEN','DRIVER_TIMING_APPEAL_CONFLICT',",1)).encode()
 elif label=='driver':
  for n in ['driver-performance.js','driver-timing-review.js']:changes[n]=(D/'backend'/n).read_bytes()
 else:
  n='order-exception-cases.js';s=old.read(n).decode();source=(R/'backend/staff-service'/n).read_text()
  # Preserve colleague changes: inject only the new projection and selector into captured runtime.
  needle=' const r=row.exceptionResolution,base=';a=source.index(" if(row.kind==='DRIVER_SERVICE_REVIEW')");b=source.index(needle,a);assert s.count(needle)==1;s=s.replace(needle,source[a:b]+needle,1)
  needle="!/^RETURN#[1-9][0-9]{0,2}$/.test(caseKey||'')";assert s.count(needle)==1;s=s.replace(needle,"! /^(?:RETURN|DRIVER_SERVICE)#[1-9][0-9]{0,2}$/.test(caseKey||'')",1);changes[n]=s.encode()
 with zipfile.ZipFile(P/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  for n,v in changes.items():
   if n not in old.namelist():out.writestr(n,v)
 new=zipfile.ZipFile(P/(label+'-candidate.zip'));assert all(new.read(n)==old.read(n)for n in old.namelist()if n not in changes)
 runtime=P/(label+'-runtime');runtime.mkdir(exist_ok=True);new.extractall(runtime)
 for n,v in changes.items():
  if n.endswith('.js'):subprocess.run(['node','--check',str(runtime/n)],check=True)
 rows.append({'label':label,'function':cfg['FunctionName'],'before':cfg['CodeSha256'],'revision':cfg['RevisionId'],'candidate':base64.b64encode(hashlib.sha256((P/(label+'-candidate.zip')).read_bytes()).digest()).decode(),'changedFiles':list(changes),'allOtherEntriesIdentical':True})
(R/'docs/driver-timing-review-packages-279.json').write_text(json.dumps({'status':'PREPARED_NOT_PUBLISHED','functions':rows,'newPermissions':False,'financialCalculationChanged':False},indent=2)+'\n')
job=aws('amplify','list-jobs','--app-id','d2vmebm1e1n95m','--branch-name','staging','--max-results','1')['jobSummaries'][0];assert job['status']=='SUCCEED'
steps=aws('amplify','get-job','--app-id','d2vmebm1e1n95m','--branch-name','staging','--job-id',job['jobId'])['job']['steps']
url=next(x['artifactsUrl']for x in steps if x['stepName']=='DEPLOY')
with urllib.request.urlopen(url,timeout=60)as response:data=response.read()
(P/'web-base.zip').write_bytes(data);old=zipfile.ZipFile(P/'web-base.zip');changes={}
for n in ['driver-timing-review.js','pages/driver-timing-review.html']:changes[n]=(R/'frontend'/n).read_bytes()
s=old.read('order-management.js').decode();needle=" content.append(button('تحديث الحالة'";source=(R/'frontend/order-management.js').read_text();a=source.index(" if(['delivered','completed']");b=source.index(needle,a);assert s.count(needle)==1;s=s.replace(needle,source[a:b]+needle,1);changes['order-management.js']=s.encode()
s=old.read('order-exception-cases.js').decode();needle='async function open(item){';source=(R/'frontend/order-exception-cases.js').read_text();a=source.index(needle);b=source.index("if(item.type==='CUSTOMER_CASH_REVIEW')",a);assert s.count(needle)==1;s=s.replace(needle,source[a:b],1)
needle='CUSTOMER_CASH_REVIEW:'
if needle in s:s=s.replace(needle,"DRIVER_TIMING_REVIEW:'مراجعة أداء — التأخير',OPEN:'بانتظار حسم المراجعة',APPEAL_OPEN:'اعتراض قيد المراجعة',RESOLVED:'حُسمت المراجعة',"+needle)
changes['order-exception-cases.js']=s.encode()
for n,asset in [('pages/orders.html','order-management.js'),('pages/order-exceptions.html','order-exception-cases.js')]:
 s=old.read(n).decode();s=re.sub('('+re.escape(asset)+r'\?v=)[^\"]+',r'\g<1>279a'if asset=='order-exception-cases.js' else r'\g<1>279',s);changes[n]=s.encode()
with zipfile.ZipFile(P/'web-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
 for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
 for n,v in changes.items():
  if n not in old.namelist():out.writestr(n,v)
new=zipfile.ZipFile(P/'web-candidate.zip');assert all(old.read(n)==new.read(n)for n in old.namelist()if n not in changes);new.extractall(P/'web-runtime')
(P/'web-manifest.json').write_text(json.dumps({'beforeJob':job['jobId'],'changes':list(changes),'sha256':hashlib.sha256((P/'web-candidate.zip').read_bytes()).hexdigest()}))
print('Captured current staging; isolated candidates prepared for 3 functions and hosting; unrelated files byte-identical.')
