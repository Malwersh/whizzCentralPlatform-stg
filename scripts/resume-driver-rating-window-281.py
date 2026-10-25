from pathlib import Path
import subprocess,json,base64,hashlib,urllib.request,os,datetime
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-rating-window-281')
def aws(*a):
 raw=subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']);return json.loads(raw)if raw.strip()else{}
f=R/'docs/driver-rating-window-publication-281.json';report=json.loads(f.read_text());assert report['status']=='PUBLISHING'and report.get('changeSetExecuted')and report.get('readOnlyIamPolicy')=='DriverRatingWindow281'
items=json.loads((R/'docs/driver-rating-window-packages-281.json').read_text())['functions'];rating=next(x for x in items if x['label']=='ratings');driver=next(x for x in items if x['label']=='driver')
assert aws('sts','get-caller-identity')['Account']=='699561669180'
assert aws('cloudformation','describe-stacks','--stack-name','whizz-order-ratings-staging')['Stacks'][0]['StackStatus']=='UPDATE_COMPLETE'
table=aws('dynamodb','describe-table','--table-name','whizz-order-ratings-staging')['Table'];index=next(x for x in table['GlobalSecondaryIndexes']if x['IndexName']=='DriverRatingChronology281');assert index['IndexStatus']=='ACTIVE';assert table['KeySchema']==[{'AttributeName':'pk','KeyType':'HASH'}]
cfg=aws('lambda','get-function-configuration','--function-name',rating['function']);assert cfg['CodeSha256']==rating['candidate'],'Rating code drift'
# Old local JS SDK cannot refresh this SSO token. Use the same CLI profile's cached
# short-lived role credentials in memory, never shell arguments, files or output.
raw=subprocess.check_output(['aws','configure','export-credentials','--profile','Wizz_stg_UserApp','--format','process']);creds=json.loads(raw);assert creds.get('SessionToken')and creds['AccessKeyId'].startswith('ASIA')
expiration=datetime.datetime.fromisoformat(creds['Expiration'].replace('Z','+00:00'));assert expiration>datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=30)
env={**os.environ,'AWS_REGION':'us-east-1','NODE_PATH':str(R/'backend/wallet-service/node_modules'),'AWS_ACCESS_KEY_ID':creds['AccessKeyId'],'AWS_SECRET_ACCESS_KEY':creds['SecretAccessKey'],'AWS_SESSION_TOKEN':creds['SessionToken']};env.pop('AWS_PROFILE',None);env.pop('AWS_DEFAULT_PROFILE',None)
subprocess.check_call(['node',str(R/'scripts/verify-driver-rating-index-281.cjs')],env=env,cwd=R)
report['indexVerification']=json.loads((P/'index-verification.json').read_text());report['indexStatus']='ACTIVE';report['localSdkSsoCompatibility']='Verified using same approved AWS CLI profile cached short-lived role credentials in memory; no secrets persisted.'
for x in report['functions']:
 if x['function']==rating['function']:x['revision']=cfg['RevisionId'];x['postIndexCodeHashReverified']=True
f.write_text(json.dumps(report,indent=2)+'\n')
assert base64.b64encode(hashlib.sha256((P/'driver-candidate.zip').read_bytes()).digest()).decode()==driver['candidate']
cfg=aws('lambda','get-function-configuration','--function-name',driver['function']);assert cfg['CodeSha256']in [driver['before'],driver['candidate']],'Driver code drift'
if cfg['CodeSha256']==driver['before']:
 assert cfg['RevisionId']==driver['revision'],'Driver revision drift'
 aws('lambda','update-function-code','--function-name',driver['function'],'--revision-id',driver['revision'],'--zip-file','fileb://'+str(P/'driver-candidate.zip'))
 subprocess.check_call(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1','lambda','wait','function-updated-v2','--function-name',driver['function']])
live=aws('lambda','get-function','--function-name',driver['function']);cfg=live['Configuration'];assert cfg['CodeSha256']==driver['candidate'];old=json.loads((P/'driver-config.private.json').read_text());assert all(cfg.get(k)==old.get(k)for k in ['Environment','Role','Handler','Runtime','MemorySize','Timeout'])
with urllib.request.urlopen(live['Code']['Location'],timeout=120)as response:assert response.read()==(P/'driver-candidate.zip').read_bytes()
report['functions']=[x for x in report['functions']if x['function']!=driver['function']]+[{'function':driver['function'],'hash':driver['candidate'],'revision':cfg['RevisionId'],'downloadedByteIdentical':True,'configUnchanged':True}];report['status']='PUBLISHED_STAGING';f.write_text(json.dumps(report,indent=2)+'\n');print('Index ACTIVE and source verified; driver V4 published and downloaded byte-identical. No repeated infrastructure or metadata writes.',flush=True)
