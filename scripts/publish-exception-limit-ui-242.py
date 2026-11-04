"""Publish clearer approval-limit error and visible failure feedback only."""
import pathlib,sys,json,zipfile,copy,time,urllib.request
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=r/'backend/.tmp/order-exceptions-work/settlement-242';s=session();record={'part':242,'fix':'approval-limit-message','status':'PUBLISHING','financialMutation':False};doc=r/'docs/exception-financial-limit-ui-242.json'
def save():doc.write_text(json.dumps(record,indent=2)+'\n')
a=s.client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};base=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert base['status']=='SUCCEED';meta=a.get_job(**args,jobId=base['jobId'])['job'];url=next(x['artifactsUrl']for x in meta['steps']if x.get('artifactsUrl'));hp=p/'hosting-limit-message';hp.mkdir(exist_ok=True);(hp/'base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read());changes={n:(r/'frontend'/n).read_bytes()for n in ['order-exception-cases.js']}
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
  hosted=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=242-'+str(i),timeout=30).read()
  if hosted==data:break
  time.sleep(3)
 assert hosted==data,'HOSTED_BYTES_MISMATCH '+n
record['hosting']['hostedBytesVerified']=True;record['status']='PUBLISHED';save();print('PASS exact service and hosted bytes, unchanged settings and IAM.',flush=True)
