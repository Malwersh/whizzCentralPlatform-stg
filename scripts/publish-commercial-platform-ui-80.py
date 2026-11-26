"""Overlay only tested notification JS and explicit script references on the latest hosted build."""
import pathlib,json,importlib.util,urllib.request,zipfile,copy,re,time,hashlib
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/sharing80');sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 assert json.loads((O/'backend-publication.json').read_text())['readerProbe']['confirmedYty'];assert json.loads((O/'browser.json').read_text())['passed']
 a=m.session().client('amplify');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};job=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert job['status']=='SUCCEED';meta=a.get_job(**args,jobId=job['jobId'])['job'];url=next(x['artifactsUrl'] for x in meta['steps'] if x.get('artifactsUrl'));(O/'frontend.base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read());changes={n:(R/'frontend'/n).read_bytes() for n in ['commercial-management.js','commercial-platform-notices.js']}
 with zipfile.ZipFile(O/'frontend.base.zip') as old:
  with zipfile.ZipFile('/private/tmp/sharing78/frontend.candidate.zip') as expected:assert old.read('commercial-management.js')==expected.read('commercial-management.js'),'LIVE_COMMERCIAL_UI_DRIFT'
  pages=[p for p in (R/'frontend/pages').glob('*.html') if 'commercial-platform-notices.js?v=80' in p.read_text()]
  for p in pages:
   name='pages/'+p.name;content=old.read(name).decode();assert 'commercial-platform-notices.js' not in content
   if p.name in ['merchants.html','promotions.html']:
    content,count=re.subn(r'(src="\.\./commercial-management.js)(?:\?[^"\s]*)?"',r'\1?v=80"',content);assert count==1
   assert '</body>' in content;changes[name]=content.replace('</body>','<script src="../commercial-platform-notices.js?v=80"></script>\n</body>',1).encode()
  with zipfile.ZipFile(O/'frontend.candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
   for item in old.infolist():out.writestr(copy.copy(item),changes.get(item.filename,old.read(item.filename)))
   for name,data in changes.items():
    if name not in old.namelist():out.writestr(name,data)
  with zipfile.ZipFile(O/'frontend.candidate.zip') as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
 assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==job['jobId'],'HOSTING_DRIFT'
 upload=a.create_deployment(**args);payload=(O/'frontend.candidate.zip').read_bytes();result={'baseJobId':job['jobId'],'jobId':upload['jobId'],'changedFiles':list(changes),'sha256':hashlib.sha256(payload).hexdigest(),'pollIntervalMs':2000,'financialWrites':False};save=lambda:(O/'frontend-publication.json').write_text(json.dumps(result,indent=2));save();urllib.request.urlopen(urllib.request.Request(upload['zipUploadUrl'],data=payload,method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=upload['jobId'])
 for _ in range(90):
  state=a.get_job(**args,jobId=upload['jobId'])['job']['summary']['status']
  if state in ['SUCCEED','FAILED','CANCELLED']:break
  time.sleep(2)
 result['status']=state;save();assert state=='SUCCEED',state
 for n in ['commercial-management.js','commercial-platform-notices.js']:
  hosted=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?v=80',timeout=30).read();assert hosted==changes[n],'HOSTED_BYTES_MISMATCH'
 result['hostedBytesVerified']=True;save();print(json.dumps(result))
if __name__=='__main__':main()
