"""Presentation/read-only trip settlement and central transfer-policy help. No financial actions."""
import boto3,pathlib,zipfile,copy,urllib.request,json,hashlib,base64,time
R=pathlib.Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';P=pathlib.Path('/private/tmp/trip-transfer-270');P.mkdir(exist_ok=True)
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');iam=s.client('iam');a=s.client('amplify');report={}
f=l.get_function(FunctionName='DriversApi-staging');urllib.request.urlretrieve(f['Code']['Location'],P/'driver-base.zip')
with zipfile.ZipFile(P/'driver-base.zip')as old:
 source=old.read('lambda_driver_api_v2.js').decode();needle="require('./driver-trip-history').tripView(order,normalizeOrderPricingToIqd,toNumber)";assert source.count(needle)==2,'Trip route drift';source=source.replace(needle,"await require('./driver-trip-history').tripWithSettlement(order,normalizeOrderPricingToIqd,toNumber,readTripSettlement)",1)
 needle="  const trips = items.map(order => require('./driver-trip-history').tripView(order,normalizeOrderPricingToIqd,toNumber));";assert needle in source
 source=source.replace(needle,"  const trips=[];\n  for(let offset=0;offset<items.length;offset+=4)trips.push(...await Promise.all(items.slice(offset,offset+4).map(order=>require('./driver-trip-history').tripWithSettlement(order,normalizeOrderPricingToIqd,toNumber,readTripSettlement))));")
 i=source.index('async function getDriverTrips(');source=source[:i]+"async function readTripSettlement(orderId,sk){\n if(!process.env.WALLET_HOLDS_TABLE)throw Error('SETTLEMENT_READER_UNAVAILABLE');\n return (await dynamodb.send(new GetCommand({TableName:process.env.WALLET_HOLDS_TABLE,Key:{orderId,sk},ConsistentRead:true}))).Item;\n}\n\n"+source[i:]
 local=(D/'backend/driver-trip-history.js').read_text();before,extension=local.split('// Cancellation awards',1);assert old.read('driver-trip-history.js').decode().rstrip()==before.rstrip(),'History module drift'
 changes={'lambda_driver_api_v2.js':source.encode(),'driver-trip-history.js':local.encode()}
 with zipfile.ZipFile(P/'driver-code.zip','w',zipfile.ZIP_DEFLATED)as new:
  for ent in old.infolist():new.writestr(copy.copy(ent),changes.get(ent.filename,old.read(ent.filename)))
 with zipfile.ZipFile(P/'driver-code.zip')as new:assert all(old.read(n)==new.read(n)for n in old.namelist()if n not in changes)
role=f['Configuration']['Role'].split('/')[-1];policy={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['dynamodb:GetItem'],'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/staging-Holds'}]};iam.put_role_policy(RoleName=role,PolicyName='driver-trip-settlement-read-270',PolicyDocument=json.dumps(policy));(D/'backend/driver-trip-settlement-iam.json').write_text(json.dumps(policy,indent=2)+'\n')
env=f['Configuration']['Environment']['Variables'];env['WALLET_HOLDS_TABLE']='staging-Holds';l.update_function_configuration(FunctionName='DriversApi-staging',RevisionId=f['Configuration']['RevisionId'],Environment={'Variables':env});l.get_waiter('function_updated_v2').wait(FunctionName='DriversApi-staging');c=l.get_function_configuration(FunctionName='DriversApi-staging');raw=(P/'driver-code.zip').read_bytes();l.update_function_code(FunctionName='DriversApi-staging',RevisionId=c['RevisionId'],ZipFile=raw);l.get_waiter('function_updated_v2').wait(FunctionName='DriversApi-staging');after=l.get_function_configuration(FunctionName='DriversApi-staging');assert after['CodeSha256']==base64.b64encode(hashlib.sha256(raw).digest()).decode();report['driverApi']={'before':f['Configuration']['CodeSha256'],'after':after['CodeSha256'],'changedFiles':list(changes),'otherFilesPreserved':True};print('DRIVER_TRIP_READER_PUBLISHED',flush=True)
# Audit the actual deployed transfer modules without altering settings or money.
w=l.get_function(FunctionName='staging-wizz-wallet-service');urllib.request.urlretrieve(w['Code']['Location'],P/'wallet.zip')
with zipfile.ZipFile(P/'wallet.zip')as z:
 names=['transferService','transferSettings','transferClient','transferVerification'];report['transferModulesMatchLive']={n:z.read('dist/'+n+'.js')==(R/'backend/wallet-service/dist'/ (n+'.js')).read_bytes()for n in names}
 assert all(report['transferModulesMatchLive'].values()),'Live transfer module drift'
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
