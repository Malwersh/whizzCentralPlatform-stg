"""Prepare a narrow live-frontend overlay and review bundle; no publication or approval writes."""
import pathlib,json,hashlib,base64,zipfile,copy,urllib.request,importlib.util
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path('/private/tmp/finance64')
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
def main():
 spec=importlib.util.spec_from_file_location('capture',ROOT/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);s=m.session();a=s.client('amplify');job=a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];last=json.loads((OUT/'frontend-latest.json').read_text());assert last['downloaded'] and job['jobId']==last['jobId'] and job['status']=='SUCCEED'
 source=OUT/'frontend-latest.zip';assert sha(source.read_bytes())==last['codeSha256'];(OUT/'frontend.zip').write_bytes(source.read_bytes())
 names=['pages/delivery-pricing.html','delivery-pricing.js','commercial-management.js'];changes={n:(ROOT/'frontend'/n).read_bytes() for n in names}
 with zipfile.ZipFile(source) as old:
  for n in names+['pages/merchants.html']:assert urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n,timeout=30).read()==old.read(n),'HOSTED_DRIFT '+n
  page=old.read('pages/merchants.html').decode();anchor='<script src="../commercial-management.js?v=20261017-branch-picker"></script>';assert page.count(anchor)==1;changes['pages/merchants.html']=page.replace(anchor,'<script src="../finance-sample.js?v=64"></script>\n    <script src="../commercial-management.js?v=64"></script>').encode()
  for n in ['finance-sample.js','finance-sample-64.json']:assert n not in old.namelist();changes[n]=(ROOT/'frontend'/n).read_bytes()
  assert not (OUT/'frontend.candidate.zip').exists()
  with zipfile.ZipFile(OUT/'frontend.candidate.zip','w',zipfile.ZIP_DEFLATED) as new:
   for info in old.infolist():new.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
   for n,data in changes.items():
    if n not in old.namelist():new.writestr(n,data)
 with zipfile.ZipFile(source) as old,zipfile.ZipFile(OUT/'frontend.candidate.zip') as new:
  assert all(new.read(n)==old.read(n) for n in old.namelist() if n not in changes)
 report={'part':64,'frontend':{'baseJobId':job['jobId'],'baseCodeSha256':sha(source.read_bytes()),'candidateCodeSha256':sha((OUT/'frontend.candidate.zip').read_bytes()),'changedFiles':list(changes),'preservedFiles':len(old.namelist())-4},'sourceHashes':{str((ROOT/'frontend'/n).relative_to(ROOT)):hashlib.sha256((ROOT/'frontend'/n).read_bytes()).hexdigest() for n in changes},'branchId':json.loads(changes['finance-sample-64.json'])['businessId'],'allApplicationDataDeclaredTestByUser':True,'activationPerformed':False,'persistedDrafts':False,'fabricatedConsent':False}
 (OUT/'preparation.json').write_text(json.dumps(report,indent=2));print(json.dumps({'preparedFiles':len(changes),'preservedFiles':report['frontend']['preservedFiles'],'baseJobId':job['jobId'],'activationPerformed':False}))
if __name__=='__main__':main()
