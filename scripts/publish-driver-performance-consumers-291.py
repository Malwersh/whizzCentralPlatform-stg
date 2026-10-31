"""Deploy only verified captured deltas after explicit user approval. No policy or money writes."""
from pathlib import Path
import json,subprocess,hashlib,base64,urllib.request,sys
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-performance-projection-291');BASE=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(BASE+list(a));return json.loads(raw)if raw.strip()else{}
assert '--approved-staging-infrastructure'in sys.argv,'Explicit user approval required'
assert aws('cloudformation','describe-stacks','--stack-name','staging-driver-performance-projection')['Stacks'][0]['StackStatus']in['CREATE_COMPLETE','UPDATE_COMPLETE']
items=json.loads((R/'docs/driver-performance-projection-packages-291.json').read_text())['functions']+json.loads((R/'docs/driver-performance-policy-compatibility-packages-291.json').read_text())['functions']
for i in items:
 cfg=aws('lambda','get-function-configuration','--function-name',i['function']);assert cfg['CodeSha256']==i['baseHash'],'Live code drift: '+i['function'];assert cfg['RevisionId']==i['revision'],'Configuration drift: '+i['function'];assert base64.b64encode(hashlib.sha256((P/i['function']/'candidate.zip').read_bytes()).digest()).decode()==i['candidateHash']
reader={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'dynamodb:GetItem','Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/DriverPerformanceSnapshots_staging'}]};forward={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'lambda:InvokeFunction','Resource':'arn:aws:lambda:us-east-1:699561669180:function:staging-driver-performance-collector'}]}
consumers=items[:5];readerRoles=sorted(set(i['roleArn'].split('/')[-1]for i in consumers if i['function']!='WaveSystem_CreateDispatchJob'));forwardRole=next(i['roleArn'].split('/')[-1]for i in consumers if i['function']=='WaveSystem_CreateDispatchJob')
report={'status':'PUBLISHING','userApproval':'EXPLICIT_STAGING_INFRASTRUCTURE_APPROVAL_RECEIVED','policies':[],'functions':[],'sourceBusinessWrites':0,'liveDispatchPolicyChanged':False,'readModelEnabled':False}
receipt=R/'docs/driver-performance-projection-publication-291.json'
def save():receipt.write_text(json.dumps(report,indent=2)+'\n')
def policy(role,name,value):
 # A customer-managed policy avoids the pre-existing 10KB inline-policy limit.
 arn='arn:aws:iam::699561669180:policy/wizz/staging/staging-'+name
 existing=subprocess.run(BASE+['iam','get-policy','--policy-arn',arn],capture_output=True,text=True)
 if existing.returncode==0:
  version=json.loads(existing.stdout)['Policy']['DefaultVersionId'];document=aws('iam','get-policy-version','--policy-arn',arn,'--version-id',version)['PolicyVersion']['Document'];assert document==value,'Different managed policy'
 else:
  assert 'NoSuchEntity'in existing.stderr,existing.stderr
  file=P/(name+'.json');file.write_text(json.dumps(value));created=aws('iam','create-policy','--policy-name','staging-'+name,'--path','/wizz/staging/','--policy-document','file://'+str(file));assert created['Policy']['Arn']==arn
 aws('iam','attach-role-policy','--role-name',role,'--policy-arn',arn)
 old=subprocess.run(BASE+['iam','get-role-policy','--role-name',role,'--policy-name',name],capture_output=True,text=True)
 if old.returncode==0:
  assert json.loads(old.stdout)['PolicyDocument']==value
  aws('iam','delete-role-policy','--role-name',role,'--policy-name',name)
 report['policies'].append({'role':role,'name':name,'managedArn':arn,'document':value});save()
for role in readerRoles:policy(role,'DriverPerformanceRead291',reader)
policy(forwardRole,'DriverPerformanceForward291',forward)
for i in items:
 name=i['function'];aws('lambda','update-function-code','--function-name',name,'--revision-id',i['revision'],'--zip-file','fileb://'+str(P/name/'candidate.zip'))
 subprocess.check_call(BASE+['lambda','wait','function-updated-v2','--function-name',name]);after=aws('lambda','get-function','--function-name',name);cfg=after['Configuration'];before=json.loads((P/name/'config.private.json').read_text());assert cfg['CodeSha256']==i['candidateHash']
 for k in ['Environment','Role','Runtime','Handler','MemorySize','Timeout']:assert cfg.get(k)==before.get(k),(name,k)
 assert urllib.request.urlopen(after['Code']['Location'],timeout=120).read()==(P/name/'candidate.zip').read_bytes()
 report['functions'].append({'name':name,'hash':cfg['CodeSha256'],'changedFiles':i['changedFiles'],'configurationPreserved':True,'downloadByteVerified':True});save();print('Published verified '+name,flush=True)
report['status']='PUBLISHED_BYTE_VERIFIED_FLAGS_STILL_OFF';save();print(report['status'],flush=True)
