"""Update sharing labels to restaurant consent; preserve unrelated hosted assets."""
import pathlib,json,importlib.util,urllib.request,zipfile,copy,re,time,hashlib
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/sharing83');sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 assert json.loads((O/'publication.json').read_text())['runtimeAuthGuardsPassed'];a=m.session().client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};job=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert job['status']=='SUCCEED';meta=a.get_job(**args,jobId=job['jobId'])['job'];url=next(x['artifactsUrl'] for x in meta['steps'] if x.get('artifactsUrl'));(O/'frontend.base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read());changes={'commercial-management.js':(R/'frontend/commercial-management.js').read_bytes()}
 with zipfile.ZipFile(O/'frontend.base.zip') as old:
  assert changes['commercial-management.js'].decode().replace('موافقة المطعم','موافقة المالك').encode()==old.read('commercial-management.js'),'LIVE_COMMERCIAL_UI_DRIFT'
  for name in old.namelist():
   if not name.startswith('pages/') or not name.endswith('.html'):continue
   content=old.read(name).decode()
   if 'commercial-management.js?v=' not in content:continue
   changes[name]=re.sub(r'commercial-management\.js\?v=[^\"\s<>]+','commercial-management.js?v=83',content).encode()
  assert len(changes)>1
  with zipfile.ZipFile(O/'frontend.candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
   for item in old.infolist():out.writestr(copy.copy(item),changes.get(item.filename,old.read(item.filename)))
  with zipfile.ZipFile(O/'frontend.candidate.zip') as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
 assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==job['jobId'];upload=a.create_deployment(**args);payload=(O/'frontend.candidate.zip').read_bytes();result={'baseJobId':job['jobId'],'jobId':upload['jobId'],'changedFiles':list(changes),'sha256':hashlib.sha256(payload).hexdigest(),'presentationOnly':True,'applicationDataWrites':False};save=lambda:(O/'frontend-publication.json').write_text(json.dumps(result,indent=2));save();urllib.request.urlopen(urllib.request.Request(upload['zipUploadUrl'],data=payload,method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=upload['jobId'])
 for _ in range(90):
  state=a.get_job(**args,jobId=upload['jobId'])['job']['summary']['status']
  if state in ['SUCCEED','FAILED','CANCELLED']:break
  time.sleep(2)
 result['status']=state;save();assert state=='SUCCEED'
 for n in ['commercial-management.js','pages/promotions.html']:
  assert urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=83',timeout=30).read()==changes[n],'HOSTED_BYTES_MISMATCH'
 result['hostedBytesVerified']=True;save();print(json.dumps(result))
if __name__=='__main__':main()
