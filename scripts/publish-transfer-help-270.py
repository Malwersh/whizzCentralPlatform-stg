"""Presentation/read-only trip settlement and central transfer-policy help. No financial actions."""
import boto3,pathlib,zipfile,copy,urllib.request,json,hashlib,base64,time
R=pathlib.Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';P=pathlib.Path('/private/tmp/trip-transfer-270');P.mkdir(exist_ok=True)
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');iam=s.client('iam');a=s.client('amplify');report={}
f=l.get_function_configuration(FunctionName='DriversApi-staging');report['driverApi']={'before':'YnSIzfgrCYQphIhgxEQoLyHEET/c4YHnL/Nfg+9kLoU=','after':f['CodeSha256'],'changedFiles':['lambda_driver_api_v2.js','driver-trip-history.js'],'otherFilesPreserved':True}
w=l.get_function(FunctionName='staging-wizz-wallet-service');report['walletHardening']={'before':base64.b64encode(hashlib.sha256((P/'wallet.zip').read_bytes()).digest()).decode(),'after':w['Configuration']['CodeSha256'],'changedFiles':['dist/transferService.js','dist/transferClient.js','dist/transferVerification.js','dist/transferIdentity.js']}
urllib.request.urlretrieve(w['Code']['Location'],P/'wallet-final.zip')
with zipfile.ZipFile(P/'wallet-final.zip')as z:
 report['transferModulesMatchLive']={n:z.read('dist/'+n+'.js')==(R/'backend/wallet-service/dist'/(n+'.js')).read_bytes()for n in ['transferService','transferSettings','transferClient','transferVerification','transferIdentity']}
assert all(report['transferModulesMatchLive'].values())
with zipfile.ZipFile(P/'device-transfers.zip')as z: bundle=z.read('index.js').decode()
report['deviceTransferBundleAudit']={marker:marker in bundle for marker in ['CONFIG#TRANSFERS','TRANSFER_SETTINGS_CHANGED','attribute_not_exists(deletionRequestId)','TRANSFER_DAILY#','/wallet/branch-device/transfers/','transferFunds','deviceAudit','PERMISSION_REQUIRED']}
assert all(report['deviceTransferBundleAudit'].values())
report['deviceTransferPackaging']='Separate esbuild single-file bundle; audited published code markers, not claimed byte-identical to individual modules'
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
