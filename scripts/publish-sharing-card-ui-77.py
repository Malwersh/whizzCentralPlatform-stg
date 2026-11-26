"""Presentation-only sharing cards. Preserve all other hosted files and all backend state."""
import pathlib,json,importlib.util,urllib.request,zipfile,copy,hashlib,re,time
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/sharing77');O.mkdir(exist_ok=True);sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 assert json.loads(pathlib.Path('/private/tmp/sharing77-browser.log').read_text())['passed'];a=m.session().client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};job=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert job['status']=='SUCCEED';meta=a.get_job(**args,jobId=job['jobId'])['job'];url=next(x['artifactsUrl'] for x in meta['steps'] if x.get('artifactsUrl'));(O/'frontend.base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read());changes={'commercial-management.js':(R/'frontend/commercial-management.js').read_bytes()}
 with zipfile.ZipFile(O/'frontend.base.zip') as old:
  expected_path=O/'frontend.candidate.zip' if (O/'publication.json').exists() and json.loads((O/'publication.json').read_text()).get('status')=='SUCCEED' else pathlib.Path('/private/tmp/sharing76/frontend.candidate.zip')
  with zipfile.ZipFile(expected_path) as expected:assert old.read('commercial-management.js')==expected.read('commercial-management.js'),'LIVE_UI_DRIFT'
  for n in ['pages/merchants.html','pages/promotions.html']:
   text,count=re.subn(r'(src="\.\./commercial-management.js)(?:\?[^"\s]*)?"',r'\1?v=77.1"',old.read(n).decode());assert count==1;changes[n]=text.encode()
  with zipfile.ZipFile(O/'frontend.candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
   for i in old.infolist():out.writestr(copy.copy(i),changes.get(i.filename,old.read(i.filename)))
  with zipfile.ZipFile(O/'frontend.candidate.zip') as out:assert all(old.read(n)==out.read(n) for n in old.namelist() if n not in changes)
 assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==job['jobId'];upload=a.create_deployment(**args);payload=(O/'frontend.candidate.zip').read_bytes();result={'baseJobId':job['jobId'],'jobId':upload['jobId'],'changedFiles':list(changes),'sha256':hashlib.sha256(payload).hexdigest(),'backendChanged':False,'applicationDataWrites':False};save=lambda:(O/'publication.json').write_text(json.dumps(result,indent=2));save();urllib.request.urlopen(urllib.request.Request(upload['zipUploadUrl'],data=payload,method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).close();a.start_deployment(**args,jobId=upload['jobId'])
 for _ in range(100):
  status=a.get_job(**args,jobId=upload['jobId'])['job']['summary']['status'];assert status not in ['FAILED','CANCELLED']
  if status=='SUCCEED':break
  time.sleep(3)
 assert status=='SUCCEED';result['status']=status
 for n,b in changes.items():
  for _ in range(15):
   if urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n,timeout=30).read()==b:break
   time.sleep(2)
  else:raise AssertionError('HOSTED_DRIFT '+n)
 result['hostedFilesMatched']=True;save();print(json.dumps(result))
if __name__=='__main__':main()
