"""Use the protected staff reader; preserve the rest of the live site."""
import pathlib,json,importlib.util,urllib.request,zipfile,copy,hashlib,re,time
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/options74');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 result=json.loads((O/'publication.json').read_text());assert result['probeDeleted'] and result['realRoleReadProbe']['count']>=0;assert json.loads(pathlib.Path('/private/tmp/options-browser.log').read_text())['passed'];s=m.session();a=s.client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};job=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert job['status']=='SUCCEED';meta=a.get_job(**args,jobId=job['jobId'])['job'];url=next(x['artifactsUrl'] for x in meta['steps'] if x.get('artifactsUrl'));(O/'frontend.base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read());changes={'commercial-funding-picker.js':(R/'frontend/commercial-funding-picker.js').read_bytes()}
 with zipfile.ZipFile(O/'frontend.base.zip') as old:
  with zipfile.ZipFile('/private/tmp/discount-review73/frontend.candidate.zip') as previous:assert old.read('commercial-funding-picker.js')==previous.read('commercial-funding-picker.js'),'LIVE_PICKER_DRIFT'
  assert old.read('commercial-management.js')==(R/'frontend/commercial-management.js').read_bytes(),'LIVE_COMMERCIAL_UI_DRIFT'
  for n in ['pages/merchants.html','pages/promotions.html']:
   body=old.read(n).decode();body,count=re.subn(r'(src="\.\./commercial-funding-picker.js)(?:\?[^"\s]*)?"',r'\1?v=74"',body);assert count==1;changes[n]=body.encode()
  with zipfile.ZipFile(O/'frontend.candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
   for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  with zipfile.ZipFile(O/'frontend.candidate.zip') as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
 assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==job['jobId'];upload=a.create_deployment(**args);payload=(O/'frontend.candidate.zip').read_bytes();result['amplify']={'baseJobId':job['jobId'],'jobId':upload['jobId'],'changedFiles':list(changes),'codeSha256':hashlib.sha256(payload).hexdigest()};save=lambda:(O/'publication.json').write_text(json.dumps(result,indent=2));save();urllib.request.urlopen(urllib.request.Request(upload['zipUploadUrl'],data=payload,method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).close();a.start_deployment(**args,jobId=upload['jobId'])
 for _ in range(100):
  status=a.get_job(**args,jobId=upload['jobId'])['job']['summary']['status'];assert status not in ['FAILED','CANCELLED']
  if status=='SUCCEED':break
  time.sleep(3)
 assert status=='SUCCEED';result['amplify']['status']=status;save()
 for n,b in changes.items():
  for _ in range(15):
   if urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n,timeout=30).read()==b:break
   time.sleep(2)
  else:raise AssertionError('HOSTED_DRIFT '+n)
 result['amplify']['hostedFilesMatched']=True;save();print(json.dumps(result['amplify']))
if __name__=='__main__':main()
