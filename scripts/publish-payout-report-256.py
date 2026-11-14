"""Publish cash payout report presentation 256 as a bounded overlay; preserve live packages."""
import pathlib,sys,json,hashlib,base64,zipfile,copy,time,urllib.request
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=r/'backend/.tmp/order-exceptions-work/payout-report-256';p.mkdir(parents=True,exist_ok=True);s=session();l=s.client('lambda');a=s.client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
for n in ['print','preview']:
 assert 'PASS' in pathlib.Path('/private/tmp/payout-report-256-'+n+'.log').read_text()
for n in ['wallet','bundle','tests']:
 assert 'ℹ fail 0' in pathlib.Path('/private/tmp/payout-report-256-'+n+'.log').read_text()
assert json.loads((r/'docs/payout-report-access-256.json').read_text())['status']=='PASS'
v=l.get_function(FunctionName='staging-wizz-staff-service');cfg=v['Configuration'];q=p/'staff-config.private.json';q.write_text(json.dumps(cfg,default=str));q.chmod(0o600);raw=urllib.request.urlopen(v['Code']['Location'],timeout=90).read();assert sha(raw)==cfg['CodeSha256'];(p/'staff-base.zip').write_bytes(raw)
with zipfile.ZipFile(p/'staff-base.zip')as old:
 with zipfile.ZipFile(p/'staff-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for info in old.infolist():out.writestr(copy.copy(info),(r/'backend/staff-service'/info.filename).read_bytes()if info.filename in ['settlement-runtime.js']else old.read(info.filename))
 with zipfile.ZipFile(p/'staff-candidate.zip')as out:assert all(out.read(n)==old.read(n)for n in old.namelist()if n not in ['settlement-runtime.js'])
base=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert base['status']=='SUCCEED';meta=a.get_job(**args,jobId=base['jobId'])['job'];url=next(x['artifactsUrl']for x in meta['steps']if x.get('artifactsUrl'));(p/'hosting-base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read());names=['pages/finance.html','merchant-payout-print.js'];changes={n:(r/'frontend'/n).read_bytes()for n in names}
with zipfile.ZipFile(p/'hosting-base.zip')as old:
 with zipfile.ZipFile(p/'hosting-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  for n,b in changes.items():
   if n not in old.namelist():out.writestr(n,b)
 with zipfile.ZipFile(p/'hosting-candidate.zip')as out:assert all(out.read(n)==old.read(n)for n in old.namelist()if n not in changes)
assert l.get_function_configuration(FunctionName=cfg['FunctionName'])['CodeSha256']==cfg['CodeSha256'];assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId']
record={'part':256,'status':'PUBLISHING','scope':'Readable payout report with primary voucher reference, human identities, owner receipt timestamp and optional technical appendix','businessDecisionsOrPaymentsByAgent':False,'platformWalletFundingConditionAdded':False,'companyCashAssetPostingAdded':False,'iamChanged':False};doc=r/'docs/payout-report-publication-256.json'
def save():doc.write_text(json.dumps(record,indent=2)+'\n')
new=(p/'staff-candidate.zip').read_bytes();l.update_function_code(FunctionName=cfg['FunctionName'],RevisionId=cfg['RevisionId'],ZipFile=new,Publish=False)
for _ in range(60):
 after=l.get_function_configuration(FunctionName=cfg['FunctionName'])
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha(new)
for k in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','VpcConfig']:assert cfg.get(k)==after.get(k),k
record['function']={'name':cfg['FunctionName'],'baseCodeSha256':cfg['CodeSha256'],'codeSha256':sha(new),'changedFiles':['settlement-runtime.js'],'unrelatedEntriesAndConfigurationPreserved':True};save();print('Published company cash accounting service.',flush=True)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId'];up=a.create_deployment(**args);record['hosting']={'baseJobId':base['jobId'],'jobId':up['jobId'],'changedFiles':names,'status':'UPLOADING','unrelatedFilesPreserved':True};save();urllib.request.urlopen(urllib.request.Request(up['zipUploadUrl'],data=(p/'hosting-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=up['jobId']);print('Hosting '+up['jobId'],flush=True)
for _ in range(90):
 status=a.get_job(**args,jobId=up['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
record['hosting']['status']=status;save();assert status=='SUCCEED'
for n,b in changes.items():
 for i in range(12):
  actual=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=256-'+str(i),timeout=30).read()
  if actual==b:break
  time.sleep(2)
 assert actual==b,n
record['hosting']['hostedBytesVerified']=True;record['status']='PUBLISHED';save();print('PASS service and hosted bytes verified, no money or business records changed; company cash accounting access verified separately.',flush=True)
