"""Publish only reviewed test-preset UI; never saves/approves financial policy."""
import pathlib,json,zipfile,io,copy,re,urllib.request,importlib.util,hashlib,base64,sys,time,datetime,subprocess
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance120');ARGS={'appId':'d2vmebm1e1n95m','branchName':'staging'};URL='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def main():
 sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);amp=m.session().client('amplify');latest=amp.list_jobs(**ARGS,maxResults=1)['jobSummaries'][0];prior=json.loads(pathlib.Path('/private/tmp/finance113/frontend-publication.json').read_text());assert latest['jobId']==prior['jobId'] and latest['status']=='SUCCEED','LIVE_FRONTEND_DRIFT';blob=pathlib.Path('/private/tmp/finance113/frontend.candidate.zip').read_bytes();assert base64.b64encode(hashlib.sha256(blob).digest()).decode()==prior['codeSha256'];old=zipfile.ZipFile(io.BytesIO(blob));changes={}
 for name in ['finance-sample.js','commercial-management.js','pages/merchants.html','pages/delivery-pricing.html']:
  data=old.read(name);assert urllib.request.urlopen(URL+name,timeout=40).read()==data,'HOSTED_DRIFT '+name;s=data.decode()
  if name=='finance-sample.js':assert s.count("fetch('/finance-sample-64.json'")==1;s=s.replace("fetch('/finance-sample-64.json'","fetch('/finance-sample-120.json'")
  elif name=='commercial-management.js':assert 'عينة فتوش المعتمدة' in s;s=s.replace('عينة فتوش المعتمدة','عينة فروج المدينة المعتمدة').replace('دينار لفتوش.','دينار لفروج المدينة.')
  else:s=re.sub(r'(finance-sample\.js|commercial-management\.js)\?v=[^"\s<]+',lambda match:match.group(1)+'?v=120',s)
  assert s.encode()!=data,'UNCHANGED_ENTRY '+name;changes[name]=s.encode()
 changes['finance-sample-120.json']=(R/'frontend/finance-sample-120.json').read_bytes();sample=json.loads(changes['finance-sample-120.json']);assert sample['businessId']=='business_1791634772438_p2hlg6w5qii' and sample['requiresOwnerConsent'] and sample['requiresIndependentApproval']
 for name,data in changes.items():
  if name.endswith('.js'):
   p=O/(name+'.syntax.js');p.write_bytes(data);subprocess.run(['node','--check',str(p)],check=True,capture_output=True)
 target=io.BytesIO()
 with zipfile.ZipFile(target,'w') as z:
  for info in old.infolist():z.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  for name,data in changes.items():
   if name not in old.namelist():z.writestr(name,data)
 candidate=target.getvalue();new=zipfile.ZipFile(io.BytesIO(candidate));assert all(new.read(n)==old.read(n) for n in old.namelist() if n not in changes);(O/'frontend.candidate.zip').write_bytes(candidate)
 proof={'part':120,'baseJobId':latest['jobId'],'changedFiles':list(changes),'unrelatedFilesPreserved':True,'applicationRowsWritten':False,'financialPolicyPublished':False,'ownerConsentWritten':False,'codeSha256':base64.b64encode(hashlib.sha256(candidate).digest()).decode()};(O/'frontend-preparation.json').write_text(json.dumps(proof,indent=2));print(json.dumps({'prepared':True,'changedFiles':list(changes),'applicationWrites':False}),flush=True)
 if '--execute' not in sys.argv:return
 assert not (O/'frontend-publication.json').exists(),'PUBLICATION_ALREADY_STARTED';deployment=amp.create_deployment(**ARGS);proof.update(jobId=deployment['jobId'],status='CREATED');(O/'frontend-publication.json').write_text(json.dumps(proof));urllib.request.urlopen(urllib.request.Request(deployment['zipUploadUrl'],data=candidate,method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).close();amp.start_deployment(**ARGS,jobId=deployment['jobId'])
 for _ in range(60):
  proof['status']=amp.get_job(**ARGS,jobId=deployment['jobId'])['job']['summary']['status'];(O/'frontend-publication.json').write_text(json.dumps(proof,indent=2))
  if proof['status']=='SUCCEED':break
  assert proof['status'] not in ['FAILED','CANCELLED'];time.sleep(3)
 assert proof['status']=='SUCCEED'
 for name,data in changes.items():assert urllib.request.urlopen(URL+name,timeout=40).read()==data,'PUBLISHED_FILE_MISMATCH '+name
 proof['hostedFilesMatched']=True;proof['recordedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(R/'docs/finance-farouj-preset-publication-120.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps({'jobId':proof['jobId'],'status':proof['status'],'financialPolicyPublished':False}),flush=True)
if __name__=='__main__':main()
