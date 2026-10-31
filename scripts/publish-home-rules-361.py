from pathlib import Path
import json,subprocess,hashlib,base64,time,urllib.request,zipfile
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/home-rules-361';H=P/'hosting';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m';base='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def aws(*args):
 raw=subprocess.check_output(B+list(args)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def sha(b):return hashlib.sha256(b).hexdigest()
assert aws('sts','get-caller-identity')['Account']=='699561669180'
assert '# pass 36' in Path('/tmp/flexible-home-node.log').read_text();assert 'All tests passed!' in Path('/tmp/flexible-home-flutter.log').read_text();assert Path('/tmp/flexible-home-browser.log').read_text().count('PASS section workflow UI')==2;assert 'PASS rules actual bundled routes' in Path('/tmp/flexible-home-wiring.log').read_text();assert json.loads((P/'existing-permission.json').read_text())['EvaluationResults'][0]['EvalDecision']=='allowed'
m=json.loads((P/'manifest.json').read_text());h=json.loads((H/'manifest.json').read_text());c=aws('lambda','get-function-configuration','--function-name',m['function']);assert c['RevisionId']==m['baseRevision'] and c['CodeSha256']==m['baseSha256'];assert base64.b64encode(hashlib.sha256((P/'candidate.zip').read_bytes()).digest()).decode()==m['candidateSha256'];assert sha((H/'candidate.zip').read_bytes())==h['candidateSha256'];j=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert j['jobId']==h['baseJob'] and j['status']=='SUCCEED'
with zipfile.ZipFile(H/'before.zip') as before:
 for f in h['changedFiles']+h['preservedCurrentUpdates']:assert urllib.request.urlopen(base+f+'?beforerules361='+j['jobId'],timeout=35).read()==before.read(f)
r={'part':361,'status':'PUBLISHING_FLEXIBLE_HOME_RULES','environment':'staging','layoutRecordsChanged':False,'classificationRecordsSeeded':False,'financialRecordsWritten':0,'existingStaffRolePreserved':True,'tests':{'node':36,'flutter':16,'browserViewports':[390,1280],'actualBundleWiring':True},'backwardCompatibility':'Old clients omit unsupported filtered sections; old sections retain defaults'};dest=R/'docs/home-rules-publication-361.json'
def save():dest.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
save();aws('lambda','update-function-code','--function-name',m['function'],'--revision-id',m['baseRevision'],'--zip-file','fileb://'+str(P/'candidate.zip'))
for _ in range(90):
 current=aws('lambda','get-function-configuration','--function-name',m['function'])
 if current['LastUpdateStatus']=='Successful':break
 assert current['LastUpdateStatus']!='Failed';time.sleep(1)
else:raise RuntimeError('Backend pending')
assert current['CodeSha256']==m['candidateSha256'];assert all(current.get(k)==c.get(k) for k in ['Handler','Runtime','Role','Environment','MemorySize','Timeout','Layers','Architectures','VpcConfig']);r['backend']={'function':m['function'],'sha256':current['CodeSha256'],'allOtherEntriesPreserved':True,'configurationPreserved':True};r['status']='BACKEND_PUBLISHED';save();print('Published flexible rules runtime',flush=True)
# Rebuild only the derived statistics record; do not touch orders or layout content.
result=aws('lambda','invoke','--function-name',m['function'],'--cli-binary-format','raw-in-base64-out','--payload','{"action":"home_discovery_tick"}',str(P/'first-rebuild.json'));assert not result.get('FunctionError');metrics=json.loads((P/'first-rebuild.json').read_text());assert metrics.get('rebuilt') is True;r['snapshot']={'rebuilt':True,'branches':metrics['branches'],'asOf':metrics['asOf']};save();print('Initialized completed-order snapshot for',metrics['branches'],'branches',flush=True)
ruleName='staging-home-discovery-refresh-361';rule=aws('events','put-rule','--name',ruleName,'--schedule-expression','rate(1 hour)','--state','ENABLED','--description','Refresh bounded completed-order discovery snapshot; no financial mutations');arn=rule['RuleArn']
try:policy=json.loads(aws('lambda','get-policy','--function-name',m['function'])['Policy'])
except subprocess.CalledProcessError:policy={'Statement':[]}
existing=[s for s in policy['Statement'] if s.get('Sid')=='HomeDiscoveryRefresh361']
if existing:assert existing[0]['Condition']['ArnLike']['AWS:SourceArn']==arn
else:aws('lambda','add-permission','--function-name',m['function'],'--statement-id','HomeDiscoveryRefresh361','--action','lambda:InvokeFunction','--principal','events.amazonaws.com','--source-arn',arn)
targets=[{'Id':'home-discovery','Arn':current['FunctionArn'],'Input':'{"action":"home_discovery_tick"}','RetryPolicy':{'MaximumRetryAttempts':2,'MaximumEventAgeInSeconds':3600}}];(P/'targets.json').write_text(json.dumps(targets));assert aws('events','put-targets','--rule',ruleName,'--targets','file://'+str(P/'targets.json'))['FailedEntryCount']==0;r['schedule']={'rule':ruleName,'period':'1 hour','invokePermissionBoundToRule':True};save()
url='https://7oum9md7v6.execute-api.us-east-1.amazonaws.com/staging/staff/public/home-slideshow?layoutVersion=2';feed=json.loads(urllib.request.urlopen(url,timeout=40).read());assert 'catalog' in feed['layout']['discovery'];assert feed['layout']['discovery']['stats'] is not None;r['publicFeedVerified']=True;save()
d=aws('amplify','create-deployment','--app-id',APP,'--branch-name','staging');job=d['jobId'];urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=(H/'candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=45).read();aws('amplify','start-deployment','--app-id',APP,'--branch-name','staging','--job-id',job);r['hosting']={'jobId':job,'previousJob':h['baseJob'],'sourceHashes':h['sourceHashes'],'allOtherEntriesPreserved':True};r['status']='HOSTING_PUBLISHING';save();print('Started rules editor hosting',job,flush=True)
for _ in range(120):
 status=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',job)['job']['summary']['status']
 if status=='SUCCEED':break
 assert status not in ['FAILED','CANCELLED'];time.sleep(3)
else:raise RuntimeError('Hosting pending')
for attempt in range(20):
 if all(sha(urllib.request.urlopen(base+f+'?verifyrules361='+job+'-'+str(attempt),timeout=35).read())==digest for f,digest in h['sourceHashes'].items()):break
 time.sleep(2)
else:raise RuntimeError('CDN verification pending')
with zipfile.ZipFile(H/'before.zip') as before:
 for f in h['preservedCurrentUpdates']:assert urllib.request.urlopen(base+f+'?preservedrules361='+job,timeout=35).read()==before.read(f)
r['status']='PUBLISHED_STAGING_VERIFIED';save();print('PASS rules feed, fresh metrics and hosting; original section content and colleague updates preserved',flush=True)
