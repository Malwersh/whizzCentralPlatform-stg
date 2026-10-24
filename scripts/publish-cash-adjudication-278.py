import sys,pathlib,json,zipfile,copy,hashlib,base64,urllib.request,time,io
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/cash-adjudication-278')
for name in ['wallet-all','bundle-tests','retention','staff-all']:assert 'fail 0' in pathlib.Path('/private/tmp/cash-adjudication-278-'+name+'.log').read_text(),name
for name in ['browser','browser-new']:assert 'PASS' in pathlib.Path('/private/tmp/cash-adjudication-278-'+name+'.log').read_text(),name
assert not pathlib.Path('/private/tmp/cash-adjudication-278-tsc.log').read_text().strip()
s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');a=s.client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
packages=json.loads((p/'packages.json').read_text());doc=r/'docs/cash-adjudication-publication-278.json';record={'part':278,'status':'PREPARED','scope':'staging','functions':packages,'iamOrConfigurationChanged':False,'existingOrderOrFinancialRecordsModified':False,'humanAcceptance':'PENDING','realCashMovedByAgent':False}
def save():doc.write_text(json.dumps(record,indent=2)+'\n')
# Refuse stale snapshots before performing the first mutation.
for f in packages:assert l.get_function_configuration(FunctionName=f['function'])['CodeSha256']==f['baseCodeSha256'],f['label']
base=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert base['status']=='SUCCEED';job=a.get_job(**args,jobId=base['jobId'])['job'];url=next(v['artifactsUrl'] for v in job['steps'] if v.get('artifactsUrl'));(p/'hosting-base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read())
changes={n:(r/'frontend'/n).read_bytes() for n in ['customer-cash-review.js','pages/customer-cash-review.html']}
with zipfile.ZipFile(p/'hosting-base.zip') as old:
 with zipfile.ZipFile(p/'hosting-candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
 with zipfile.ZipFile(p/'hosting-candidate.zip') as new:
  assert sorted(new.namelist())==sorted(old.namelist())
  assert all(new.read(n)==old.read(n) for n in old.namelist() if n not in changes)
record['status']='PUBLISHING';save()
for label in ['deletion','expiry','financial','staff']:
 f=next(x for x in packages if x['label']==label);payload=(p/(label+'-candidate.zip')).read_bytes();before=json.loads((p/(label+'-config.private.json')).read_text());cfg=l.get_function_configuration(FunctionName=f['function']);assert cfg['CodeSha256']==f['baseCodeSha256'];assert hashlib.sha256(payload).hexdigest()==f['packageSha256']
 l.update_function_code(FunctionName=f['function'],RevisionId=cfg['RevisionId'],ZipFile=payload,Publish=False)
 for _ in range(75):
  after=l.get_function_configuration(FunctionName=f['function'])
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==sha(payload),label
 for key in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Layers','VpcConfig','Architectures']:assert before.get(key)==after.get(key),(label,key)
 f['deployedCodeSha256']=after['CodeSha256'];save();print('Updated bounded overlay: '+label,flush=True)
# Reject an unrelated hosting release racing our capture.
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId']
u=a.create_deployment(**args);urllib.request.urlopen(urllib.request.Request(u['zipUploadUrl'],data=(p/'hosting-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=u['jobId']);record['hosting']={'jobId':u['jobId'],'baseJobId':base['jobId'],'changedFiles':list(changes),'unrelatedEntriesPreserved':True};save();print('Hosting '+u['jobId'],flush=True)
for _ in range(90):
 state=a.get_job(**args,jobId=u['jobId'])['job']['summary']['status']
 if state in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
assert state=='SUCCEED',state
for f in packages:
 live=l.get_function(FunctionName=f['function']);assert live['Configuration']['CodeSha256']==f['deployedCodeSha256'];actual=zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(live['Code']['Location'],timeout=90).read()));candidate=zipfile.ZipFile(p/(f['label']+'-candidate.zip'));original=zipfile.ZipFile(p/(f['label']+'-base.zip'));assert sorted(actual.namelist())==sorted(candidate.namelist())
 for n in actual.namelist():
  assert actual.read(n)==candidate.read(n),(f['label'],n)
  if n not in f['changedFiles']:assert actual.read(n)==original.read(n),(f['label'],n)
 f['allDeployedBytesVerified']=True;save()
for n,raw in changes.items():
 for attempt in range(5):
  found=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?verify=278-'+str(attempt),timeout=30).read()
  if found==raw:break
  time.sleep(3)
 assert found==raw,n
# Invalid original tokens may never execute an adjudication or open a case.
res=l.invoke(FunctionName=next(f['function'] for f in packages if f['label']=='financial'),Payload=json.dumps({'action':'staff_cash_case','accessToken':'invalid-smoke-token','body':{'action':'OPEN_CASH_REVIEW','orderId':'invalid-negative-order','expectedVersion':0,'idempotencyKey':'11111111-1111-4111-8111-111111111111','reason':'negative authentication smoke'}}).encode());body=json.loads(res['Payload'].read());assert not res.get('FunctionError') and body['statusCode']==401,body
record.update(status='PUBLISHED_VERIFIED',negativeSmokeStatus=401);save();print('PASS: exact deployed bytes and hosted files verified; no business record was mutated by the agent.',flush=True)
