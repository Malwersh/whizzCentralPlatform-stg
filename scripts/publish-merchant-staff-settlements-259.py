"""Bounded staging release. No employee grants, cash movements, payout actions or OTP."""
import pathlib,sys,json,zipfile,copy,hashlib,base64,time,urllib.request
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/registry-259');s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');a=s.client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
for key in ['wallet','staff','new','bundle','merchant']:
 assert 'ℹ fail 0' in pathlib.Path('/private/tmp/merchant-staff-settlement-259-'+key+'.log').read_text(),key
assert 'All tests passed!' in pathlib.Path('/private/tmp/merchant-staff-settlement-259-flutter.log').read_text();assert all(x['decision']=='allowed'for x in json.loads((p/'iam-access.json').read_text()))
packages=json.loads((p/'packages.json').read_text());doc=r/'docs/merchant-staff-settlements-publication-259.json';record=json.loads(doc.read_text())if doc.exists()else {'part':259,'status':'PUBLISHING','functions':[],'iamChanged':False,'employeeMembershipGrantsChanged':False,'financialActionsRequested':False,'otpSent':False}
def save():doc.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
# Assert every baseline before the first mutation; a resumed release accepts only its own candidate.
for item in packages:
 b=(p/(item['function']+'-candidate.zip')).read_bytes();assert hashlib.sha256(b).hexdigest()==item['packageSha256'];cfg=l.get_function_configuration(FunctionName=item['function']);assert cfg['CodeSha256'] in [item['baseCodeSha256'],sha(b)],item['function']
base=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert base['status']=='SUCCEED';job=a.get_job(**args,jobId=base['jobId'])['job'];url=next(x['artifactsUrl']for x in job['steps']if x.get('artifactsUrl'));(p/'hosting-base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read());changes={n:(r/'frontend'/n).read_bytes()for n in ['pages/finance.html','merchant-payouts.js','merchant-payout-print.js']}
with zipfile.ZipFile(p/'hosting-base.zip')as old:
 with zipfile.ZipFile(p/'hosting-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for e in old.infolist():out.writestr(copy.copy(e),changes.get(e.filename,old.read(e.filename)))
  for n,b in changes.items():
   if n not in old.namelist():out.writestr(n,b)
 with zipfile.ZipFile(p/'hosting-candidate.zip')as out:assert all(old.read(n)==out.read(n)for n in old.namelist()if n not in changes)
for item in packages:
 name=item['function'];raw=(p/(name+'-candidate.zip')).read_bytes();cfg=l.get_function_configuration(FunctionName=name);before=json.loads((p/(name+'.private.json')).read_text())
 if cfg['CodeSha256']!=sha(raw):
  assert cfg['CodeSha256']==item['baseCodeSha256'];l.update_function_code(FunctionName=name,RevisionId=cfg['RevisionId'],ZipFile=raw,Publish=False)
  for _ in range(90):
   cfg=l.get_function_configuration(FunctionName=name)
   if cfg['LastUpdateStatus']!='InProgress':break
   time.sleep(2)
 assert cfg['LastUpdateStatus']=='Successful' and cfg['CodeSha256']==sha(raw),name
 for k in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Architectures','VpcConfig','Layers']:assert cfg.get(k)==before.get(k),(name,k)
 if not any(x['function']==name for x in record['functions']):record['functions'].append({**item,'deployedCodeSha256':cfg['CodeSha256'],'configurationPreserved':True})
 save();print('Verified '+name,flush=True)
# No financial mutation: malformed device token is rejected before any datastore access.
response=l.invoke(FunctionName='staging-wizz-staff-service',Payload=json.dumps({'action':'merchant_device_payout','deviceToken':'invalid','staffSession':'invalid','httpMethod':'GET','input':{'view':'payout-context','branchId':'invalid'}}).encode());smoke=json.loads(response['Payload'].read());assert not response.get('FunctionError'),smoke;assert smoke.get('statusCode')==401,smoke;record['invalidDeviceSmoke']=smoke;save();print('Verified device rejection',flush=True)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId'];up=a.create_deployment(**args);record['hosting']={'baseJobId':base['jobId'],'jobId':up['jobId'],'changedFiles':list(changes),'status':'UPLOADING','unrelatedEntriesPreserved':True};save();urllib.request.urlopen(urllib.request.Request(up['zipUploadUrl'],data=(p/'hosting-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=up['jobId']);print('Hosting '+up['jobId'],flush=True)
for _ in range(100):
 status=a.get_job(**args,jobId=up['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
record['hosting']['status']=status;save();assert status=='SUCCEED'
for n,b in changes.items():
 for i in range(12):
  actual=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=259-'+str(i),timeout=30).read()
  if actual==b:break
  time.sleep(2)
 assert actual==b,n
record['hosting']['hostedBytesVerified']=True;record['status']='PUBLISHED_POLICY_PENDING';save();print('PASS bounded service and hosting publication; policy activation pending.',flush=True)
