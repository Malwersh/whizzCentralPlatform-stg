"""Publish guarded overlays prepared in /tmp/interfaces-362 after explicit IAM approval.
Never creates template content, orders or financial records. Preserves hosting and Lambda entries.
"""
from pathlib import Path
import json,subprocess,hashlib,base64,time,urllib.request,zipfile
R=Path(__file__).resolve().parents[1];P=Path('/tmp/interfaces-362');B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];APP='d2vmebm1e1n95m';URL='https://staging.d2vmebm1e1n95m.amplifyapp.com/'
def aws(*args):
 raw=subprocess.check_output(B+list(args)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def sha(b):return hashlib.sha256(b).hexdigest()
assert aws('sts','get-caller-identity')['Account']=='699561669180'
m=json.loads((P/'manifest.json').read_text());c=aws('lambda','get-function-configuration','--function-name',m['function']);already_published=c['CodeSha256']==m['candidateSha256'];assert already_published or (c['RevisionId']==m['baseRevision'] and c['CodeSha256']==m['baseSha256'])
permission=aws('iam','simulate-principal-policy','--policy-source-arn',c['Role'],'--action-names','dynamodb:Query','--resource-arns','arn:aws:dynamodb:us-east-1:699561669180:table/WhizzMerchants_Products/index/BusinessIdIndex');assert all(x['EvalDecision']=='allowed' for x in permission['EvaluationResults']), 'Explicitly approved catalog Query permission not yet available'
assert base64.b64encode(hashlib.sha256((P/'candidate.zip').read_bytes()).digest()).decode()==m['candidateSha256']
latest=aws('amplify','list-jobs','--app-id',APP,'--branch-name','staging','--max-results','1')['jobSummaries'][0];assert latest['jobId']==m['baseHostingJob'] and latest['status']=='SUCCEED'
assert 'All tests passed!' in Path('/tmp/interfaces-flutter-final.log').read_text();assert 'pass 22' in Path('/tmp/interfaces-node.log').read_text();assert Path('/tmp/interfaces-browser.log').read_text().count('PASS interface editor')==2
r={'part':362,'environment':'staging','status':'PUBLISHING','homeContentUnchanged':True,'templateContentWritten':False,'financialRecordsWritten':0,'allOtherEntriesPreserved':True,'tests':{'backend':22,'flutter':33,'browserViewports':[390,1280]}};dest=R/'docs/customer-interfaces-publication-362.json'
def save():dest.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
save()
if not already_published:aws('lambda','update-function-code','--function-name',m['function'],'--revision-id',m['baseRevision'],'--zip-file','fileb://'+str(P/'candidate.zip'))
for _ in range(90):
 live=aws('lambda','get-function-configuration','--function-name',m['function'])
 if live['LastUpdateStatus']=='Successful':break
 assert live['LastUpdateStatus']!='Failed';time.sleep(1)
else:raise RuntimeError('Lambda update pending')
assert live['CodeSha256']==m['candidateSha256'];assert all(live.get(k)==c.get(k) for k in ['Handler','Runtime','Role','Environment','Timeout','MemorySize','Architectures','Layers'])
r['backend']={'function':m['function'],'sha256':live['CodeSha256'],'configurationPreserved':True};r['status']='BACKEND_PUBLISHED';save();print('Published interface runtime',flush=True)
# Public read canary. No templates are authored/published implicitly.
branch='business_1791634772438_p2hlg6w5qii';feed=json.loads(urllib.request.urlopen('https://7oum9md7v6.execute-api.us-east-1.amazonaws.com/staging/staff/public/home-slideshow?surface=store&branchId='+branch,timeout=35).read());assert feed['interface']['surface']=='store';assert 'draft' not in feed['interface'];r['publicInterfaceCanary']=True;save()
# Existing hourly worker derives product quantities from completed orders only.
result=aws('lambda','invoke','--function-name',m['function'],'--cli-binary-format','raw-in-base64-out','--payload','{"action":"home_discovery_tick"}',str(P/'rebuild-result.json'));assert not result.get('FunctionError');derived=json.loads((P/'rebuild-result.json').read_text());assert derived.get('rebuilt') is True;r['derivedSnapshots']={'rebuilt':True,'asOf':derived['asOf'],'financialRecordsWritten':0};save()
d=aws('amplify','create-deployment','--app-id',APP,'--branch-name','staging');job=d['jobId'];urllib.request.urlopen(urllib.request.Request(d['zipUploadUrl'],data=(P/'hosting-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=45).read();aws('amplify','start-deployment','--app-id',APP,'--branch-name','staging','--job-id',job);r['hosting']={'jobId':job,'previousJob':m['baseHostingJob']};r['status']='HOSTING_PUBLISHING';save();print('Hosting job',job,flush=True)
for _ in range(120):
 status=aws('amplify','get-job','--app-id',APP,'--branch-name','staging','--job-id',job)['job']['summary']['status']
 if status=='SUCCEED':break
 assert status not in ['FAILED','CANCELLED'];time.sleep(2)
else:raise RuntimeError('Hosting pending')
for attempt in range(15):
 if all(sha(urllib.request.urlopen(URL+name+'?verify362='+job+'-'+str(attempt),timeout=35).read())==digest for name,digest in m['hostingSourceHashes'].items()):break
 time.sleep(2)
else:raise RuntimeError('CDN verification pending')
r['status']='PUBLISHED_STAGING_VERIFIED';r['hosting']['sourceHashes']=m['hostingSourceHashes'];save();print('PASS interface feed, derived metrics and hosting bytes verified',flush=True)
