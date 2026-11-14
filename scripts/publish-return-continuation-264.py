"""Publish custody execution and appeals only; preserve the live financial implementations."""
import pathlib,sys,json,zipfile,copy,hashlib,base64,urllib.request,time
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/return-continuation-264');s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');a=s.client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
for key in ['wallet','staff','merchant-backend','driver-backend','tests','bundle','proxies','capabilities']:assert 'ℹ fail 0'in pathlib.Path('/private/tmp/return-continuation-264-'+key+'.log').read_text(),key
for key in ['browser','preflight']:assert 'PASS'in pathlib.Path('/private/tmp/return-continuation-264-'+key+'.log').read_text(),key
for app in ['merchant','driver']:
 assert 'All tests passed!'in pathlib.Path('/private/tmp/return-continuation-264-'+app+'-flutter.log').read_text()
 assert '✓ Built'in pathlib.Path('/private/tmp/return-continuation-264-'+app+'-ios.log').read_text()
assert all(x['decision']=='allowed'for x in json.loads((p/'access.json').read_text()))
packages=json.loads((p/'packages.json').read_text());record={'part':264,'status':'PUBLISHING','scope':'staging','functions':[],'iamChanged':False,'realOrderReceiptCustodyOrFinancialMutationByAgent':False,'existingCasesMigrated':False,'originalReceiptPreserved':True,'nativeBuilds':{'merchant':228,'driverSimulatorDebug':214},'features':['authenticated supplemental receipt','registered staff custody transfer','witnessed disposal','evidence-backed missing quantity review','physical driver task completion','company custody register','pinned-window appeals','financial action fences during custody or appeal review']};doc=r/'docs/return-continuation-publication-264.json'
def save():doc.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
for f in packages:
 raw=(p/(f['label']+'-candidate.zip')).read_bytes();assert hashlib.sha256(raw).hexdigest()==f['packageSha256'];cfg=l.get_function_configuration(FunctionName=f['function']);assert cfg['CodeSha256']in[f['baseCodeSha256'],sha(raw)],f['function']
base=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert base['status']=='SUCCEED';job=a.get_job(**args,jobId=base['jobId'])['job'];url=next(x['artifactsUrl']for x in job['steps']if x.get('artifactsUrl'));(p/'hosting-base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read());changes={n:(r/'frontend'/n).read_bytes()for n in ['case-workflow.js','case-continuation.js','order-exception-cases.js','pages/order-exceptions.html']}
with zipfile.ZipFile(p/'hosting-base.zip')as old:
 assert b'case-workflow.js?v=263'in old.read('pages/order-exceptions.html')and b'case-workflow.js?v=264'in changes['pages/order-exceptions.html']
 with zipfile.ZipFile(p/'hosting-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for e in old.infolist():out.writestr(copy.copy(e),changes.get(e.filename,old.read(e.filename)))
  for n,b in changes.items():
   if n not in old.namelist():out.writestr(n,b)
 with zipfile.ZipFile(p/'hosting-candidate.zip')as out:assert all(old.read(n)==out.read(n)for n in old.namelist()if n not in changes)
# Activate the protected writer before making the new proxies and UI available.
for label in ['financial','staff','merchant','driver']:
 f=next(x for x in packages if x['label']==label);raw=(p/(label+'-candidate.zip')).read_bytes();before=json.loads((p/(label+'-config.private.json')).read_text());cfg=l.get_function_configuration(FunctionName=f['function']);assert cfg['CodeSha256']in[f['baseCodeSha256'],sha(raw)]
 if cfg['CodeSha256']!=sha(raw):l.update_function_code(FunctionName=f['function'],RevisionId=cfg['RevisionId'],ZipFile=raw,Publish=False)
 for _ in range(90):
  after=l.get_function_configuration(FunctionName=f['function'])
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha(raw)
 for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Layers','VpcConfig','Architectures']:assert before.get(k)==after.get(k),(label,k)
 record['functions'].append({**f,'deployedCodeSha256':after['CodeSha256'],'configurationPreserved':True});save();print('Verified '+f['function'],flush=True)
record['negativeSmoke']=[]
for action in ['return_case_driver','return_case_owner','exception_case_admin']:
 response=l.invoke(FunctionName='staging-driver-financial-accept',Payload=json.dumps({'action':action,'accessToken':'invalid-smoke-token','body':{'action':'READ_RETURN_CONTINUATION'if action!='exception_case_admin'else'OPEN_CASE_APPEAL','orderId':'smoke-order','caseKey':'CURRENT'}}).encode());result=json.loads(response['Payload'].read());assert not response.get('FunctionError')and result['statusCode']==401,result;record['negativeSmoke'].append({'action':action,'statusCode':401,'code':result['code']});save()
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId'];up=a.create_deployment(**args);record['hosting']={'baseJobId':base['jobId'],'jobId':up['jobId'],'changedFiles':list(changes),'status':'UPLOADING','unrelatedFilesPreserved':True};save();urllib.request.urlopen(urllib.request.Request(up['zipUploadUrl'],data=(p/'hosting-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=up['jobId']);print('Hosting '+up['jobId'],flush=True)
for _ in range(100):
 status=a.get_job(**args,jobId=up['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
record['hosting']['status']=status;save();assert status=='SUCCEED'
for n,b in changes.items():
 for i in range(12):
  actual=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=264-'+str(i),timeout=30).read()
  if actual==b:break
  time.sleep(2)
 assert actual==b,n
record['hosting']['hostedBytesVerified']=True;record['status']='PUBLISHED';save();print('PASS authenticated custody and appeals publication; no real receipt, handover, appeal, payment or guarantee decision by agent.',flush=True)
