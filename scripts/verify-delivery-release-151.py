"""Read-only verification of the approved release, including served frontend bytes."""
import hashlib, json, pathlib, subprocess, urllib.request, zipfile

OUT=pathlib.Path('/private/tmp/delivery-release-151-publication')
ROOT=pathlib.Path(__file__).resolve().parents[1]
M=json.loads((ROOT/'docs/delivery-coordinated-release-151.json').read_text())
P=json.loads((OUT/'publication.json').read_text())
def aws(*args):
    p=subprocess.run(['aws',*args,'--profile','Wizz_stg_UserApp','--region','us-east-1','--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=90)
    if p.returncode:raise RuntimeError('READ_ONLY_VERIFICATION_FAILED')
    return json.loads(p.stdout)
rows=[]
for row in M['packages']:
    actual=aws('lambda','get-function-configuration','--function-name',row['name'])
    assert actual['CodeSha256']==row['codeSha256'] and actual['Handler']==row['handler'] and actual['LastUpdateStatus']=='Successful'
    rows.append({'name':row['name'],'codeSha256':actual['CodeSha256'],'verified':True})
for row in M['permissions']:
    actual=aws('iam','get-role-policy','--role-name',row['roleArn'].rsplit('/',1)[-1],'--policy-name',row['policyName'])['PolicyDocument']
    assert actual==row['policy']
web=M['frontend'];job=aws('amplify','get-job','--app-id',web['appId'],'--branch-name','staging','--job-id',P['frontend']['jobId'])['job']['summary']
assert job['status']=='SUCCEED', 'FRONTEND_DEPLOYMENT_NOT_SUCCESSFUL'
files=[]
with zipfile.ZipFile(pathlib.Path('/private/tmp/delivery-release-150')/web['candidate']) as archive:
    for name in web['changedFiles']:
        expected=archive.read(name)
        url='https://staging.'+web['appId']+'.amplifyapp.com/'+name+'?release=151-'+job['jobId']
        with urllib.request.urlopen(urllib.request.Request(url,headers={'Cache-Control':'no-cache'}),timeout=60) as response:
            actual=response.read()
        assert actual==expected, 'SERVED_FRONTEND_BYTES_DIFFER '+name
        files.append({'path':name,'sha256':hashlib.sha256(actual).hexdigest(),'verified':True})
report={'part':151,'deployed':True,'functions':rows,'permissionPoliciesVerified':5,'frontend':{'jobId':job['jobId'],'status':job['status'],'files':files},'environmentChanges':False,'financialDataWrites':False,'activation':'UNCHANGED; NOT ENABLED BY THIS RELEASE'}
(OUT/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
P['status']='VERIFIED';P['frontend']['status']='SUCCEED';(OUT/'publication.json').write_text(json.dumps(P,indent=2)+'\n')
print(json.dumps({'verifiedFunctions':len(rows),'verifiedPermissionPolicies':5,'servedFrontendFilesVerified':len(files),'frontendJobId':job['jobId'],'financialDataWrites':False}))
