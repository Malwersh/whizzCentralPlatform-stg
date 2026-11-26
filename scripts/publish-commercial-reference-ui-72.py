"""Publish explicit save outcomes without changing authentication or approval policy."""
import pathlib,json,importlib.util,urllib.request,zipfile,copy,hashlib,base64,re,time,difflib
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/reference72');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 assert json.loads((O/'browser.log').read_text())['realWrites'] is False;s=m.session();a=s.client('amplify');job=a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert job['status']=='SUCCEED';meta=a.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=job['jobId'])['job'];url=next(x['artifactsUrl'] for x in meta['steps'] if x.get('artifactsUrl'));data=urllib.request.urlopen(url,timeout=90).read();(O/'frontend.feedback.base.zip').write_bytes(data);changes={n:(R/'frontend'/n).read_bytes() for n in ['commercial-management.js']}
 with zipfile.ZipFile(O/'frontend.feedback.base.zip') as old:
  for n,b in changes.items():
   assert urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n,timeout=30).read()==old.read(n)
   diff=list(difflib.unified_diff(old.read(n).decode().splitlines(),b.decode().splitlines(),n,n,n=1));assert len(diff)<60,'UI_DRIFT '+n;(O/('feedback-'+n+'.diff')).write_text('\n'.join(diff))
  for n,script in [('pages/merchants.html','commercial-management.js'),('pages/promotions.html','commercial-management.js')]:
   body=old.read(n).decode();body,count=re.subn(r'(src="\.\./'+re.escape(script)+r')(?:\?[^"\s]*)?"',r'\1?v=72"',body);assert count==1;changes[n]=body.encode()
  with zipfile.ZipFile(O/'frontend.feedback.candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
   for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  with zipfile.ZipFile(O/'frontend.feedback.candidate.zip') as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
 latest=a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert latest['jobId']==job['jobId'];candidate=(O/'frontend.feedback.candidate.zip').read_bytes();upload=a.create_deployment(appId='d2vmebm1e1n95m',branchName='staging');p=json.loads((O/'publication.json').read_text());p['amplify']={'baseJobId':job['jobId'],'jobId':upload['jobId'],'changedFiles':list(changes),'codeSha256':base64.b64encode(hashlib.sha256(candidate).digest()).decode()};save=lambda:(O/'publication.json').write_text(json.dumps(p,indent=2));save();urllib.request.urlopen(urllib.request.Request(upload['zipUploadUrl'],data=candidate,method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).close();a.start_deployment(appId='d2vmebm1e1n95m',branchName='staging',jobId=upload['jobId'])
 for _ in range(90):
  row=a.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=upload['jobId'])['job']['summary'];assert row['status'] not in ['FAILED','CANCELLED']
  if row['status']=='SUCCEED':break
  time.sleep(3)
 assert row['status']=='SUCCEED';p['amplify']['status']='SUCCEED';save()
 for n,b in changes.items():
  for _ in range(10):
   if urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n,timeout=30).read()==b:break
   time.sleep(2)
  else:raise AssertionError('HOSTED_DRIFT '+n)
 p['amplify']['hostedFilesMatched']=True;save();print(json.dumps({'referenceUiPublished':True,'jobId':upload['jobId'],'changedFiles':len(changes)}))
if __name__=='__main__':main()
