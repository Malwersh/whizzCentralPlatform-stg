"""Small frontend-only release using the verified current Amplify archive. No Lambda/IAM/data mutations."""
import pathlib,json,zipfile,importlib.util,subprocess,hashlib,base64,urllib.request,datetime,time,sys,re
ROOT=pathlib.Path(__file__).resolve().parents[1];R=pathlib.Path('/private/tmp/commercial-branch-picker-20261017');BASE=pathlib.Path('/private/tmp/finance60')
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
def once(s,old,new):
 assert s.count(old)==1,'ANCHOR_DRIFT: '+old;return s.replace(old,new,1)
def prepare():
 R.mkdir(mode=0o700,exist_ok=True)
 assert not (R/'preparation.json').exists() and not (R/'candidate.zip').exists(),'PREPARATION_ALREADY_COMPLETE'
 before=json.loads((BASE/'publication.json').read_text());meta=json.loads((BASE/'preparation.json').read_text());old=BASE/'frontend.candidate.zip';assert sha(old.read_bytes())==meta['packages']['frontend']['codeSha256']
 (R/'rollback.zip').write_bytes(old.read_bytes())
 spec=importlib.util.spec_from_file_location('overlay',ROOT/'scripts/prepare-central-pricing-release-56.py');overlay=importlib.util.module_from_spec(spec);spec.loader.exec_module(overlay)
 with zipfile.ZipFile(old) as z:
  changes={'commercial-management.js':(ROOT/'frontend/commercial-management.js').read_bytes()}
  local=(ROOT/'frontend/merchants.js').read_text();start=local.index('// Reuse the same completed merchant inventory');end=local.index('// Utility to add a timeout',start);bridge=local[start:end]
  s=z.read('merchants.js').decode();s=once(s,'let filteredMerchants = [];','let filteredMerchants = [];\n\n'+bridge)
  for oldline,newline in [
   ('    merchantsData = data.merchants || data;',"    merchantsData = data.merchants || data;\n    publishCommercialMerchantSource('READY',merchantsData);"),
   ('async function loadMerchantsFromDynamoDB() {',"async function loadMerchantsFromDynamoDB() {\n    publishCommercialMerchantSource('LOADING');"),
   ('            merchantsData = data.Items.map(item => ({',"            publishCommercialMerchantSource('READY',data.Items);\n            merchantsData = data.Items.map(item => ({"),
   ("            console.log('No merchants found in DynamoDB');","            publishCommercialMerchantSource('READY',[]);\n            console.log('No merchants found in DynamoDB');"),
   ("        console.error('Error loading merchants from DynamoDB:', error);","        publishCommercialMerchantSource('ERROR');\n        console.error('Error loading merchants from DynamoDB:', error);"),
   ("        console.error('❌ Error loading merchants from database:', error);","        publishCommercialMerchantSource('ERROR');\n        console.error('❌ Error loading merchants from database:', error);"),
   ('async function refreshMerchantsData() {',"async function refreshMerchantsData() {\n    publishCommercialMerchantSource('LOADING');"),
   ("        console.error('Refresh failed:', error);","        publishCommercialMerchantSource('ERROR');\n        console.error('Refresh failed:', error);"),
   ('window.refreshMerchantsData = refreshMerchantsData;','window.refreshMerchantsData = refreshMerchantsData;\nwindow.reloadCommercialMerchants = refreshMerchantsData;')]:s=once(s,oldline,newline)
  changes['merchants.js']=s.encode()
  for name in ['merchants','promotions']:
   s=z.read('pages/'+name+'.html').decode();s=once(s,'../commercial-management.js?v=20261016-60','../commercial-management.js?v=20261017-branch-picker')
   if name=='merchants':
    s,count=re.subn(r'(\.\./merchants\.js)\?[^\"]+',r'\1?v=20261017-branch-picker',s);assert count==1,'MERCHANT_SCRIPT_REFERENCE_DRIFT'
   changes['pages/'+name+'.html']=s.encode()
  for name in ['commercial-management.js','merchants.js']:
   path=R/('check-'+name);path.write_bytes(changes[name]);subprocess.run(['node','--check',str(path)],check=True)
 package=overlay.archive(R/'rollback.zip',R/'candidate.zip',changes)
 result={'environment':'Staging','kind':'COMMERCIAL_BRANCH_PICKER_UI_CORRECTION','baseJobId':before['amplify']['jobId'],'baseSha256':sha(old.read_bytes()),'package':package,'backendChanged':False,'activationPerformed':False,'tests':{'branchPickerBrowser':True,'agreementAndFundingBrowser':True},'sourceSha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ['frontend/commercial-management.js','frontend/merchants.js','scripts/test-commercial-branch-picker-browser.cjs','scripts/test-commercial-management-browser.cjs']}}
 (R/'preparation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
def publish():
 import boto3
 p=json.loads((R/'preparation.json').read_text());assert sha((R/'candidate.zip').read_bytes())==p['package']['codeSha256']
 for name,digest in p['sourceSha256'].items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==digest
 s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';a=s.client('amplify')
 def current():return a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0]
 j=current();assert j['jobId']==p['baseJobId'] and j['status']=='SUCCEED','LIVE_RELEASE_DRIFT'
 with zipfile.ZipFile(R/'rollback.zip') as z:
  for name in p['package']['changedFiles']:
   if name in z.namelist():assert urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+name,timeout=30).read()==z.read(name),'HOSTED_FILE_DRIFT: '+name
 assert current()['jobId']==p['baseJobId']
 d=a.create_deployment(appId='d2vmebm1e1n95m',branchName='staging');result={**p,'published':False,'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'amplify':{'appId':'d2vmebm1e1n95m','branch':'staging','jobId':d['jobId']}}
 (R/'publication.json').write_text(json.dumps(result,indent=2))
 with urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=(R/'candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=90) as response:assert response.status in [200,201]
 a.start_deployment(appId='d2vmebm1e1n95m',branchName='staging',jobId=d['jobId'])
 for n in range(90):
  j=a.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=d['jobId'])['job']['summary'];assert j['status'] not in ['FAILED','CANCELLED']
  if j['status']=='SUCCEED':break
  time.sleep(3)
 assert j['status']=='SUCCEED'
 verify()
def verify():
 import boto3
 p=json.loads((R/'preparation.json').read_text());result=json.loads((R/'publication.json').read_text());s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';a=s.client('amplify');j=a.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=result['amplify']['jobId'])['job']['summary'];assert j['status']=='SUCCEED'
 # A completed deployment may precede CDN invalidation; verify the browser's versioned URLs too.
 for attempt in range(10):
  matched=True
  with zipfile.ZipFile(R/'candidate.zip') as z:
   for name in p['package']['changedFiles']:
    for suffix in ['', '?v='+p.get('cacheVersion','20261017-branch-picker')]:
     if urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+name+suffix,timeout=30).read()!=z.read(name):matched=False
  if matched:break
  time.sleep(3)
 assert matched,'CDN_FILES_NOT_YET_MATCHED'
 result['published']=True;result['amplify']['status']='SUCCEED';result['hostedFilesMatched']=4;result['versionedFilesMatched']=4;(R/'publication.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':
 if sys.argv[1:] == ['--prepare']:prepare()
 elif sys.argv[1:] == ['--publish']:publish()
 elif sys.argv[1:] == ['--verify']:verify()
 else:raise SystemExit('Use --prepare, --publish or --verify')
