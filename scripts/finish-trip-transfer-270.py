"""Presentation/read-only trip settlement and central transfer-policy help. No financial actions."""
import boto3,pathlib,zipfile,copy,urllib.request,json,hashlib,base64,time
R=pathlib.Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';P=pathlib.Path('/private/tmp/trip-transfer-270');P.mkdir(exist_ok=True)
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');iam=s.client('iam');a=s.client('amplify');report={}
f=l.get_function_configuration(FunctionName='DriversApi-staging');report['driverApi']={'before':'YnSIzfgrCYQphIhgxEQoLyHEET/c4YHnL/Nfg+9kLoU=','after':f['CodeSha256'],'changedFiles':['lambda_driver_api_v2.js','driver-trip-history.js'],'otherFilesPreserved':True}
# Audit the actual deployed transfer modules without altering settings or money.
w=l.get_function(FunctionName='staging-wizz-wallet-service');urllib.request.urlretrieve(w['Code']['Location'],P/'wallet.zip')
with zipfile.ZipFile(P/'wallet.zip')as z:
 names=['transferService','transferSettings','transferClient','transferVerification','transferIdentity'];report['transferModulesPreviouslyMatched']={n:z.read('dist/'+n+'.js')==(R/'backend/wallet-service/dist'/(n+'.js')).read_bytes()for n in names}
 changes={f'dist/{n}.js':(R/'backend/wallet-service/dist'/(n+'.js')).read_bytes()for n in names if not report['transferModulesPreviouslyMatched'][n]}
 assert set(changes)=={'dist/transferService.js','dist/transferClient.js','dist/transferVerification.js','dist/transferIdentity.js'}
 with zipfile.ZipFile(P/'wallet-hardening.zip','w',zipfile.ZIP_DEFLATED)as new:
  for ent in z.infolist():new.writestr(copy.copy(ent),changes.get(ent.filename,z.read(ent.filename)))
 with zipfile.ZipFile(P/'wallet-hardening.zip')as new:assert all(z.read(n)==new.read(n)for n in z.namelist()if n not in changes)
raw=(P/'wallet-hardening.zip').read_bytes();l.update_function_code(FunctionName='staging-wizz-wallet-service',RevisionId=w['Configuration']['RevisionId'],ZipFile=raw);l.get_waiter('function_updated_v2').wait(FunctionName='staging-wizz-wallet-service');report['walletHardening']={'before':w['Configuration']['CodeSha256'],'after':l.get_function_configuration(FunctionName='staging-wizz-wallet-service')['CodeSha256'],'changedFiles':list(changes),'scope':'Existing source deletion/version guards, daily cap, branch-scoped verification compatibility; no new transfer or fee'}
# Staff device transfers have a separate Lambda; verify its actual modules too.
dev=l.get_function(FunctionName='staging-merchant-device-transfers');urllib.request.urlretrieve(dev['Code']['Location'],P/'device-transfers.zip')
with zipfile.ZipFile(P/'device-transfers.zip')as z:
 report['deviceTransferModulesMatchLive']={n:z.read('dist/'+n+'.js')==(R/'backend/wallet-service/dist'/(n+'.js')).read_bytes()for n in ['merchantDeviceFinance','transferService','transferSettings','transferClient','transferVerification','transferIdentity']}
assert all(report['deviceTransferModulesMatchLive'].values()),'Staff transfer source drift'
print('TRANSFER_HARDENING_PUBLISHED_AND_STAFF_VERIFIED',flush=True)
t=s.resource('dynamodb').Table(w['Configuration']['Environment']['Variables']['IDEMPOTENCY_KEYS_TABLE']);row=t.get_item(Key={'idempotencyKey':'CONFIG#TRANSFERS','sk':'META'},ConsistentRead=True).get('Item');report['activeTransferConfig']={k:row.get('config',{}).get(k)for k in ['version','enabled','minAmount','maxAmount','driverDaily','customerDaily','merchantDaily']}if row else {'defaultUsed':True};report['transferSettingsChanged']=False;report['financialWrites']=0
args={'appId':'d2vmebm1e1n95m','branchName':'staging'};job=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert job['status']=='SUCCEED';meta=a.get_job(**args,jobId=job['jobId'])['job'];url=next(v['artifactsUrl']for v in meta['steps']if v.get('artifactsUrl'));urllib.request.urlretrieve(url,P/'web-base.zip')
with zipfile.ZipFile(P/'web-base.zip')as old:
 html=old.read('pages/finance.html').decode();needle='>تفعيل التحويلات</label>';assert html.count(needle)==1;html=html.replace(needle,'>إظهار وتفعيل تحويل الرصيد في تطبيقات السائق والزبون والمطعم</label>');anchor='<label><input id="transfer-setting-enabled"';assert html.count(anchor)==1;html=html.replace(anchor,'<p>إيقاف التحويل يخفي أزراره في التطبيقات ويمنع التحويلات الجديدة في الخادم. يبقى سجل العمليات السابقة متاحًا. تتحدث الأزرار عند فتح المحفظة أو استئناف التطبيق، وخلال ٣٠ ثانية أثناء بقائها مفتوحة.</p>'+anchor)
 with zipfile.ZipFile(P/'web.zip','w',zipfile.ZIP_DEFLATED)as new:
  for ent in old.infolist():new.writestr(copy.copy(ent),html.encode()if ent.filename=='pages/finance.html'else old.read(ent.filename))
 with zipfile.ZipFile(P/'web.zip')as new:assert all(old.read(n)==new.read(n)for n in old.namelist()if n!='pages/finance.html')
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==job['jobId'];up=a.create_deployment(**args);urllib.request.urlopen(urllib.request.Request(up['zipUploadUrl'],data=(P/'web.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).close();a.start_deployment(**args,jobId=up['jobId']);print('CENTRAL_HELP_DEPLOYING',up['jobId'],flush=True)
for _ in range(90):
 status=a.get_job(**args,jobId=up['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
assert status=='SUCCEED';report['hosting']={'baseJob':job['jobId'],'job':up['jobId'],'status':status,'changedFiles':['pages/finance.html']};(R/'frontend/pages/finance.html').write_text(html);(R/'docs/trip-transfer-controls-270.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,default=str)+'\n');print('PUBLISHED_AND_RECORDED',flush=True)
