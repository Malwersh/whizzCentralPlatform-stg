"""Run only after explicit user approval of DriverQualityCaseRead290 on staging-Holds."""
from pathlib import Path
import json,subprocess,base64,hashlib,urllib.request,sys,plistlib
if '--approved-read-policy'not in sys.argv:raise SystemExit('Explicit user approval required before adding the named read-only IAM permission.')
R=Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';P=Path('/private/tmp/driver-quality-self-service-290')
def aws(*a):
 b=subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']);return json.loads(b)if b.strip()else{}
pub=R/'docs/driver-quality-self-service-publication-290.json';report=json.loads(pub.read_text());
if report['status']=='PUBLISHED_STAGING_RELEASE290_INSTALLED_LAUNCHED':print(report['status']);raise SystemExit(0)
assert report['status']in['CORE_PUBLISHED_DRIVER_API_AND_RELEASE_READY_PERMISSION_PENDING','DRIVER_API_PUBLISHED_RELEASE_INSTALL_PENDING']
items=json.loads((R/'docs/driver-quality-self-service-packages-290.json').read_text())['functions'];i=next(x for x in items if x['label']=='driver');candidate=P/'driver-candidate.zip';assert base64.b64encode(hashlib.sha256(candidate.read_bytes()).digest()).decode()==i['candidate']
for deployed in report['functions']:assert aws('lambda','get-function-configuration','--function-name',deployed['function'])['CodeSha256']==deployed['hash'],'Core dependency drift'
cfg=aws('lambda','get-function-configuration','--function-name',i['function']);assert (cfg['CodeSha256']==i['candidate']if report.get('driverApiPublished')else cfg['CodeSha256']==i['before']and cfg['RevisionId']==i['revision']),'Drivers API drift'
policy=json.loads((R/'docs/driver-quality-read-policy-290.json').read_text());assert cfg['Role']==policy['roleArn'];role=cfg['Role'].split('/')[-1]
probe=subprocess.run(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1','iam','get-role-policy','--role-name',role,'--policy-name',policy['policyName'],'--output','json'],capture_output=True,text=True)
if probe.returncode==0:assert json.loads(probe.stdout)['PolicyDocument']==policy['policyDocument'],'Existing named policy differs'
else:
 assert 'NoSuchEntity'in probe.stderr,'Unable to verify existing policy'
 aws('iam','put-role-policy','--role-name',role,'--policy-name',policy['policyName'],'--policy-document','file://'+str(P/'driver-read-policy.json'))
probe=aws('iam','simulate-principal-policy','--policy-source-arn',cfg['Role'],'--action-names','dynamodb:Query','--resource-arns','arn:aws:dynamodb:us-east-1:699561669180:table/staging-Holds');assert all(x['EvalDecision']=='allowed'for x in probe['EvaluationResults'])
report.update(iamChanges=True,driverReadPermission='EXPLICIT_USER_APPROVED_APPLIED_VERIFIED',iamPolicy=policy['policyName']);pub.write_text(json.dumps(report,indent=2)+'\n')
if not report.get('driverApiPublished'):
 aws('lambda','update-function-code','--function-name',i['function'],'--revision-id',i['revision'],'--zip-file','fileb://'+str(candidate));subprocess.check_call(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1','lambda','wait','function-updated-v2','--function-name',i['function']])
 f=aws('lambda','get-function','--function-name',i['function']);after=f['Configuration'];assert after['CodeSha256']==i['candidate']
 for field in ['Environment','Role','Handler','Runtime','MemorySize','Timeout']:assert after.get(field)==cfg.get(field),field
 with urllib.request.urlopen(f['Code']['Location'],timeout=45)as response:assert response.read()==candidate.read_bytes()
 report['functions'].append({'function':i['function'],'hash':after['CodeSha256'],'revision':after['RevisionId'],'downloadedByteIdentical':True,'configUnchanged':True});report.update(status='DRIVER_API_PUBLISHED_RELEASE_INSTALL_PENDING',driverApiPublished=True);pub.write_text(json.dumps(report,indent=2)+'\n');print('Drivers API published and byte-verified.',flush=True)
app=D/'frontend/build/ios/iphoneos/Runner.app';info=plistlib.loads((app/'Info.plist').read_bytes());assert info['CFBundleVersion']=='290'and info['CFBundleIdentifier']=='com.wiz.wizdriverapp'
for action,args in [('install',['install','app','--device','B8850CE6-BCC2-551D-B930-3E108456B23F','--timeout','60',str(app)]),('launch',['process','launch','--device','B8850CE6-BCC2-551D-B930-3E108456B23F','--terminate-existing','--timeout','30','com.wiz.wizdriverapp'])]:
 with (P/('release290-'+action+'.log')).open('w')as log:subprocess.run(['xcrun','devicectl','device',*args],stdout=log,stderr=subprocess.STDOUT,check=True)
report.update(status='PUBLISHED_STAGING_RELEASE290_INSTALLED_LAUNCHED',driverReleaseInstalled=True,driverReleaseBuild=290);pub.write_text(json.dumps(report,indent=2)+'\n');print(report['status'],flush=True)
