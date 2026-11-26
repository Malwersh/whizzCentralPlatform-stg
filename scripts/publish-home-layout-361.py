from pathlib import Path
import subprocess,json,hashlib,base64,time,urllib.request,zipfile
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/home-layout-361';H=P/'hosting';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m';base='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def aws(*args):
 raw=subprocess.check_output(B+list(args)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def sha(b):return hashlib.sha256(b).hexdigest()
assert aws('sts','get-caller-identity')['Account']=='699561669180'
assert '# pass 27' in Path('/tmp/layout361-node-tests.log').read_text();assert Path('/tmp/layout361-browser.log').read_text().count('PASS home layout UI')==2;assert 'PASS actual bundled staff route' in Path('/tmp/layout361-wiring.log').read_text();assert 'All tests passed!' in Path('/tmp/layout361-flutter-tests.log').read_text()
m=json.loads((P/'manifest.json').read_text());h=json.loads((H/'manifest.json').read_text());c=aws('lambda','get-function-configuration','--function-name',m['function']);assert c['RevisionId']==m['baseRevision'] and c['CodeSha256']==m['baseSha256'];assert base64.b64encode(hashlib.sha256((P/'candidate.zip').read_bytes()).digest()).decode()==m['candidateSha256'];assert sha((H/'candidate.zip').read_bytes())==h['candidateSha256']
j=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert j['jobId']==h['baseJob'] and j['status']=='SUCCEED'
with zipfile.ZipFile(H/'before.zip') as z:assert urllib.request.urlopen(base+'pages/promotions.html?pre361='+j['jobId'],timeout=45).read()==z.read('pages/promotions.html')
r={'part':361,'scope':'staging','status':'PUBLISHING_HOME_LAYOUT','layoutRecordsWritten':0,'financialRecordsWritten':0,'newIamPermissions':False,'tests':{'node':27,'flutter':13,'browserScenarios':2,'actualBundleWiring':True}};dest=R/'docs/home-layout-publication-361.json'
def save():dest.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
save();aws('lambda','update-function-code','--function-name',m['function'],'--revision-id',m['baseRevision'],'--zip-file','fileb://'+str(P/'candidate.zip'))
for _ in range(90):
 v=aws('lambda','get-function-configuration','--function-name',m['function'])
 if v['LastUpdateStatus']=='Successful':break
 assert v['LastUpdateStatus']!='Failed';time.sleep(1)
else:raise RuntimeError('Backend pending')
assert v['CodeSha256']==m['candidateSha256'];assert all(v.get(k)==c.get(k) for k in ['Handler','Runtime','Role','Environment','MemorySize','Timeout','Layers','Architectures','VpcConfig']);r['backend']={'function':m['function'],'sha256':v['CodeSha256'],'configurationPreserved':True,'allOtherEntriesPreserved':True};r['status']='BACKEND_PUBLISHED';save();print('Published backend layout overlay',flush=True)
# Read-only live probe uses existing public feed: it must include the explicit unconfigured result.
u='https://7oum9md7v6.execute-api.us-east-1.amazonaws.com/staging/staff/public/home-slideshow'
data=json.loads(urllib.request.urlopen(u,timeout=45).read());assert data['layout']=={'configured':False,'version':0,'sections':[]};r['publicFeedUnconfiguredVerified']=True;save()
d=aws('amplify','create-deployment','--app-id',APP,'--branch-name','staging');job=d['jobId'];(H/'deployment.private.json').write_text(json.dumps({'jobId':job}));urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=(H/'candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=45).read();aws('amplify','start-deployment','--app-id',APP,'--branch-name','staging','--job-id',job);print('Started hosting job',job,flush=True)
for _ in range(120):
 state=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',job)['job']['summary']['status']
 if state=='SUCCEED':break
 assert state not in ['FAILED','CANCELLED'];time.sleep(3)
else:raise RuntimeError('Hosting pending')
for f,digest in h['sourceHashes'].items():assert sha(urllib.request.urlopen(base+f+'?verify361='+job,timeout=45).read())==digest
r['hosting']={'jobId':job,'previousJob':h['baseJob'],'sourceHashes':h['sourceHashes'],'allOtherEntriesPreserved':True};r['status']='PUBLISHED_STAGING_NO_LAYOUT_CONTENT_SEEDED';save();print('PASS live feed and hosting bytes; no layout or financial records created',flush=True)
