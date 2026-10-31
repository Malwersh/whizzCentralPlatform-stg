"""Apply the explicitly approved, pinned staging release 151. No environment/data writes."""
import base64, datetime, hashlib, json, os, pathlib, subprocess, sys, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
ART = pathlib.Path('/private/tmp/delivery-release-150')
OUT = pathlib.Path('/private/tmp/delivery-release-151-publication')
OUT.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(OUT, 0o700)
raw = (ROOT / 'docs/delivery-coordinated-release-151.json').read_bytes()
assert hashlib.sha256(raw).hexdigest() == '8352e1d93c968a72bae5312d689ab4029f02dccef32bf81530d75ee83cdebd4d'
M = json.loads(raw)
drift = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert drift['clean'] and (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(drift['at'])).total_seconds() < 900
assert not (OUT / 'publication.json').exists(), 'PUBLICATION_ALREADY_STARTED_REVIEW_JOURNAL'
proof = {'part':151, 'manifestSha256':hashlib.sha256(raw).hexdigest(), 'permissions':[], 'functions':[], 'frontend':None, 'environmentChanges':False, 'financialDataWrites':False, 'status':'STARTING'}
def save():
    target=OUT/'publication.json';target.write_text(json.dumps(proof,indent=2)+'\n');os.chmod(target,0o600)
def aws(*args):
    p=subprocess.run(['aws',*args,'--profile','Wizz_stg_UserApp','--region','us-east-1','--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=120)
    if p.returncode:raise RuntimeError('AWS_RELEASE_STEP_FAILED '+args[0]+'/'+args[1]+' '+p.stderr[:350])
    return json.loads(p.stdout) if p.stdout.strip() else {}
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
assert aws('sts','get-caller-identity')['Account']==M['accountId']
for row in M['packages']:
    assert base64.b64encode(hashlib.sha256((ART/row['candidate']).read_bytes()).digest()).decode()==row['codeSha256']
assert hashlib.sha256((ART/M['frontend']['candidate']).read_bytes()).hexdigest()==M['frontend']['candidateSha256']
uses=aws('lambda','list-functions','--query','Functions[].{name:FunctionName,role:Role}')
for row in M['permissions']:
    assert sorted(f['name'] for f in uses if f['role']==row['roleArn'])==sorted(row['functions']), 'ROLE_USAGE_CHANGED'
save()
try:
    for row in M['permissions']:
        role=row['roleArn'].rsplit('/',1)[-1];name=row['policyName']
        assert name not in aws('iam','list-role-policies','--role-name',role)['PolicyNames'], 'POLICY_NAME_ALREADY_EXISTS'
        pending={'role':role,'policyName':name,'status':'APPLYING'};proof['permissions'].append(pending);save()
        aws('iam','put-role-policy','--role-name',role,'--policy-name',name,'--policy-document',json.dumps(row['policy']))
        actual=aws('iam','get-role-policy','--role-name',role,'--policy-name',name)['PolicyDocument']
        assert digest(actual)==digest(row['policy'])
        pending['status']='VERIFIED';save();print(json.dumps({'permissionVerified':role}),flush=True)
    order=['staging-driver-financial-accept','staging-cod-integration','staging-merchant-response-99','order-receiver-merchant-orders-staging-v1','WaveSystem_CreateDispatchJob','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','WizzUser-CreateOrder-staging','staging-wizz-staff-service','wizzcentral-notifications-staging-pushSendMerchantOrder']
    for name in order:
        row=next(r for r in M['packages'] if r['name']==name)
        before=aws('lambda','get-function-configuration','--function-name',name)
        assert before['RevisionId']==row['baseRevisionId'] and before['CodeSha256']==row['baseCodeSha256'] and before['Handler']==row['handler']
        envhash=digest(before.get('Environment',{}).get('Variables',{}))
        item={'name':name,'status':'APPLYING','baseRevisionId':before['RevisionId'],'baseCodeSha256':before['CodeSha256']};proof['functions'].append(item);save()
        aws('lambda','update-function-code','--function-name',name,'--revision-id',before['RevisionId'],'--zip-file','fileb://'+str(ART/row['candidate']))
        for attempt in range(60):
            after=aws('lambda','get-function-configuration','--function-name',name)
            if after.get('LastUpdateStatus')=='Successful':break
            assert after.get('LastUpdateStatus')!='Failed','LAMBDA_UPDATE_FAILED'
            time.sleep(2)
        assert after.get('LastUpdateStatus')=='Successful' and after['CodeSha256']==row['codeSha256'] and after['Handler']==before['Handler'] and after['Role']==before['Role'] and digest(after.get('Environment',{}).get('Variables',{}))==envhash
        item.update(status='VERIFIED',revisionId=after['RevisionId'],codeSha256=after['CodeSha256'],environmentUnchanged=True);save();print(json.dumps({'functionVerified':name}),flush=True)
    web=M['frontend'];args=['--app-id',web['appId'],'--branch-name','staging']
    jobs=aws('amplify','list-jobs',*args,'--max-results','10')['jobSummaries']
    assert next(j['jobId'] for j in jobs if j['status']=='SUCCEED')==web['jobId'] and not any(j['status'] in ['PENDING','PROVISIONING','RUNNING'] for j in jobs)
    upload=aws('amplify','create-deployment',*args)
    proof['frontend']={'jobId':upload['jobId'],'status':'UPLOADING','baseJobId':web['jobId']};save()
    urllib.request.urlopen(urllib.request.Request(upload['zipUploadUrl'],data=(ART/web['candidate']).read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).close()
    aws('amplify','start-deployment',*args,'--job-id',upload['jobId']);proof['frontend']['status']='STARTED';proof['status']='BACKEND_VERIFIED_FRONTEND_STARTED';save()
    print(json.dumps({'backendVerified':10,'permissionsVerified':5,'frontendJobId':upload['jobId']}),flush=True)
except Exception:
    proof['status']='STOPPED_REVIEW_REQUIRED';save();raise
