"""Publish reviewed full-receipt task closure and explicit guarantee review; preserve live archives."""
import pathlib,sys,json,zipfile,hashlib,base64,copy,time,urllib.request
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=r/'backend/.tmp/order-exceptions-work/return-241';s=session();l=s.client('lambda');sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
for name in ['wallet-tests.log','captured-tests.log','staff-tests.log']:assert 'fail 0'in(p/name).read_text(),name
for name in ['browser.log','return-browser.log','findings-browser.log','authorization-browser.log']:assert 'PASS 'in(p/name).read_text(),name
for name in ['merchant-tests.log','driver-navigation-tests.log']:assert 'All tests passed!'in(p/name).read_text(),name
changesets={'financial':{'index.js':p/'financial-candidate.js','order-exception-runtime-229.js':p/'order-exception-runtime-229.js'},'staff':{'order-exception-cases.js':r/'backend/staff-service/order-exception-cases.js'}}
record={'part':241,'status':'PUBLISHING','functions':[],'financialDecisionsByAgent':False,'wholeSpecificationComplete':False};doc=r/'docs/return-custody-publication-241.json'
def save():doc.write_text(json.dumps(record,indent=2)+'\n')
for label in changesets:
 before=json.loads((p/(label+'-config.private.json')).read_text());assert l.get_function_configuration(FunctionName=before['FunctionName'])['CodeSha256']==before['CodeSha256'],'LIVE_CODE_DRIFT '+label
for label,files in changesets.items():
 before=json.loads((p/(label+'-config.private.json')).read_text());name=before['FunctionName'];current=l.get_function_configuration(FunctionName=name);assert current['CodeSha256']==before['CodeSha256']
 with zipfile.ZipFile(p/(label+'-base.zip'))as old:
  assert sha((p/(label+'-base.zip')).read_bytes())==before['CodeSha256']
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for info in old.infolist():out.writestr(copy.copy(info),files[info.filename].read_bytes()if info.filename in files else old.read(info.filename))
  with zipfile.ZipFile(p/(label+'-candidate.zip'))as out:assert all(out.read(n)==old.read(n)for n in old.namelist()if n not in files)
 raw=(p/(label+'-candidate.zip')).read_bytes();l.update_function_code(FunctionName=name,RevisionId=current['RevisionId'],ZipFile=raw,Publish=False)
 for _ in range(70):
  after=l.get_function_configuration(FunctionName=name)
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha(raw)
 for k in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage']:assert current.get(k)==after.get(k),'CONFIG_DRIFT '+k
 record['functions'].append({'name':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedFiles':list(files),'unrelatedEntriesPreserved':True,'configurationPreserved':True});save();print('Published '+name,flush=True)
a=s.client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};base=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert base['status']=='SUCCEED';meta=a.get_job(**args,jobId=base['jobId'])['job'];url=next(x['artifactsUrl']for x in meta['steps']if x.get('artifactsUrl'));hp=p/'hosting';hp.mkdir(exist_ok=True);(hp/'base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read());changes={n:(r/'frontend'/n).read_bytes()for n in ['pages/order-exceptions.html','order-exception-cases.js']}
with zipfile.ZipFile(hp/'base.zip')as old:
 with zipfile.ZipFile(hp/'candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
 with zipfile.ZipFile(hp/'candidate.zip')as out:assert all(out.read(n)==old.read(n)for n in old.namelist()if n not in changes)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId'],'HOSTING_DRIFT';up=a.create_deployment(**args);raw=(hp/'candidate.zip').read_bytes();record['hosting']={'baseJobId':base['jobId'],'jobId':up['jobId'],'status':'UPLOADING','changedFiles':list(changes),'unrelatedFilesPreserved':True};save();urllib.request.urlopen(urllib.request.Request(up['zipUploadUrl'],data=raw,method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=up['jobId']);print('Hosting '+up['jobId'],flush=True)
for _ in range(90):
 status=a.get_job(**args,jobId=up['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
record['hosting']['status']=status;save();assert status=='SUCCEED'
for n,data in changes.items():
 for i in range(12):
  hosted=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=241-'+str(i),timeout=30).read()
  if hosted==data:break
  time.sleep(3)
 assert hosted==data,'HOSTED_BYTES_MISMATCH '+n
record['hosting']['hostedBytesVerified']=True;record['status']='PUBLISHED';save();print('PASS exact service and hosted bytes, unchanged settings and IAM.',flush=True)
