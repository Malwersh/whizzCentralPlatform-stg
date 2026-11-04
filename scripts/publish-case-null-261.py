"""Presentation-only fix; preserve latest hosting and all financial records."""
import sys,pathlib,json,zipfile,copy,urllib.request,time
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/closure-260');a=session().client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};assert 'PASS' in (p/'ui-null.log').read_text();base=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert base['status']=='SUCCEED';j=a.get_job(**args,jobId=base['jobId'])['job'];url=next(x['artifactsUrl']for x in j['steps']if x.get('artifactsUrl'));(p/'ui-base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read());changes={}
with zipfile.ZipFile(p/'ui-base.zip')as old:
 key='case-workflow.js';text=old.read(key).decode();assert "const decision=card('workflow-responsibility'" in text;updated=text.replace("const decision=card('workflow-responsibility'", "const findingButton=$('record-finding');const decision=card('workflow-responsibility'",1).replace("finding.append($('record-finding'));", "finding.append(findingButton);",1);assert updated==(r/'frontend'/key).read_text();changes[key]=updated.encode();key='pages/order-exceptions.html';text=old.read(key).decode();assert text.count('case-workflow.js?v=245')==1;changes[key]=text.replace('case-workflow.js?v=245','case-workflow.js?v=261').encode()
 with zipfile.ZipFile(p/'ui-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for e in old.infolist():out.writestr(copy.copy(e),changes.get(e.filename,old.read(e.filename)))
 with zipfile.ZipFile(p/'ui-candidate.zip')as out:assert all(old.read(n)==out.read(n)for n in old.namelist()if n not in changes)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId'];up=a.create_deployment(**args);urllib.request.urlopen(urllib.request.Request(up['zipUploadUrl'],data=(p/'ui-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=up['jobId']);print('Hosting '+up['jobId'],flush=True)
for _ in range(100):
 status=a.get_job(**args,jobId=up['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
assert status=='SUCCEED'
for n,b in changes.items():
 for i in range(12):
  actual=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=261-'+str(i),timeout=30).read()
  if actual==b:break
  time.sleep(2)
 assert actual==b,n
record={'part':261,'status':'PUBLISHED_VERIFIED','hostingJobId':up['jobId'],'changedFiles':list(changes),'unrelatedHostedFilesPreserved':True,'backendChanged':False,'financialRecordsChanged':False,'nullCause':'Finding button queried after its parent was detached; append(null) rendered a literal null','browserRegression':'PASS'};(r/'docs/case-null-publication-261.json').write_text(json.dumps(record,indent=2)+'\n');print('PASS null rendering fixed and hosted bytes verified; no backend changes.',flush=True)
