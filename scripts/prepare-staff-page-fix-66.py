"""Capture and minimally patch staff route/UI; no staff or financial record writes."""
import pathlib,json,importlib.util,urllib.request,zipfile,copy,hashlib,base64,re,difflib
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/staff-load-fix-66');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
def main():
 s=m.session();l=s.client('lambda');a=s.client('amplify');f=l.get_function(FunctionName='staging-wizz-staff-service');cfg=f['Configuration'];b=urllib.request.urlopen(f['Code']['Location'],timeout=90).read();assert sha(b)==cfg['CodeSha256'];(O/'staff.zip').write_bytes(b);(O/'staff.config.private.json').write_text(json.dumps(cfg));old="if(path.startsWith('/staff/deletions/'))return";new="if(path==='/staff/deletions'||path.startsWith('/staff/deletions/'))return"
 with zipfile.ZipFile(O/'staff.zip') as z:
  body=z.read('index.js').decode();assert body.count(old)==1;changes={'index.js':body.replace(old,new).encode()}
  with zipfile.ZipFile(O/'staff.candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
   for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  with zipfile.ZipFile(O/'staff.candidate.zip') as out:assert all(out.read(n)==z.read(n) for n in z.namelist() if n!='index.js')
 job=a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert job['status']=='SUCCEED';meta=a.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=job['jobId'])['job'];urls=[x['artifactsUrl'] for x in meta['steps'] if x.get('artifactsUrl')];data=urllib.request.urlopen(urls[0],timeout=90).read();(O/'frontend.zip').write_bytes(data)
 with zipfile.ZipFile(O/'frontend.zip') as z:
  for n in ['staff.js','pages/staff.html']:assert urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n,timeout=30).read()==z.read(n),'HOSTED_DRIFT '+n
  js=z.read('staff.js').decode();old="const changes=await all('/staff/changes');const deletionJobs=(await api('/staff/deletions')).items;";new="const changes=me.directWrite?[]:await all('/staff/changes');const deletionJobs=me.directWrite?[]:(await api('/staff/deletions')).items;";assert js.count(old)==1;changed=js.replace(old,new);assert changed==(R/'frontend/staff.js').read_text(),'LOCAL_STAFF_DRIFT'
  html=z.read('pages/staff.html').decode();html,count=re.subn(r'(src="\.\./staff\.js)(?:\?[^"\s]*)?"',r'\1?v=66"',html);assert count==1;changes={'staff.js':changed.encode(),'pages/staff.html':html.encode()}
  with zipfile.ZipFile(O/'frontend.candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
   for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  with zipfile.ZipFile(O/'frontend.candidate.zip') as out:assert all(out.read(n)==z.read(n) for n in z.namelist() if n not in changes)
 p={'part':66,'staff':{'name':cfg['FunctionName'],'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'candidateCodeSha256':sha((O/'staff.candidate.zip').read_bytes()),'changedFiles':['index.js']},'frontend':{'baseJobId':job['jobId'],'candidateCodeSha256':sha((O/'frontend.candidate.zip').read_bytes()),'changedFiles':list(changes)},'humanWrites':False,'financialActivation':False};(O/'preparation.json').write_text(json.dumps(p,indent=2));print(json.dumps({'prepared':True,'frontendBaseJob':job['jobId'],'lambdaFilesChanged':1,'frontendFilesChanged':2}))
if __name__=='__main__':main()
