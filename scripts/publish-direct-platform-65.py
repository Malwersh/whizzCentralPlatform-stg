"""Publish Staging direct-write workflow without changing financial rollout gates or human records."""
import pathlib,json,importlib.util,base64,hashlib,urllib.request,time,datetime,zipfile,argparse
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance65');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
def main(mode):
 p=json.loads((O/'preparation.json').read_text());proof=json.loads((O/'dynamodb-test.json').read_text());assert all(proof.get(k) for k in ['tableDeleted','ownerConsentThenDirectPublication','ownerAcceptanceReplaySafe','fundingSavePublishesAndReplays','pricingAtomicAndStaleRejected','liveActorFence']);assert json.loads((O/'browser-direct.log').read_text())['realWrites'] is False
 assert 'pass 176' in (O/'staff-tests.log').read_text() and 'fail 0' in (O/'staff-tests.log').read_text();assert 'fail 0' in (O/'wallet-tests.log').read_text()
 for f,h in p['sourceHashes'].items():assert hashlib.sha256((R/f).read_bytes()).hexdigest()==h,'SOURCE_CHANGED '+f
 s=m.session();l=s.client('lambda');a=s.client('amplify');state=json.loads((O/'publication.json').read_text()) if (O/'publication.json').exists() else {'part':65,'financialActivationPerformed':False,'humanRowsWritten':False,'functions':[],'configuration':[]}
 def save():(O/'publication.json').write_text(json.dumps(state,indent=2))
 def base(k):return json.loads((O/(k+'.config.private.json')).read_text())
 def check(k):
  old=base(k);c=l.get_function_configuration(FunctionName=old['FunctionName']);code=next((x for x in state['functions'] if x['host']==k),None);env=next((x for x in state['configuration'] if x['host']==k),None);assert c['CodeSha256']==(code['codeSha256'] if code else old['CodeSha256']),'CODE_DRIFT '+k;assert c['RevisionId']==(env['revisionId'] if env else code['revisionId'] if code else old['RevisionId']),'REVISION_DRIFT '+k
  for f in ['Role','Runtime','Handler','Timeout','MemorySize','Layers','VpcConfig','Architectures']:assert c.get(f)==old.get(f),'CONFIG_DRIFT '+k
  expected={**old.get('Environment',{}).get('Variables',{}),**(state['directEnvironment'] if env else {})};assert c.get('Environment',{}).get('Variables',{})==expected,'ENV_DRIFT '+k
  return c
 if mode=='code':
  [check(k) for k in p['packages']]
  for k,package in p['packages'].items():
   if any(x['host']==k for x in state['functions']):continue
   data=(O/(k+'.candidate.zip')).read_bytes();assert sha(data)==package['codeSha256'];c=check(k);l.update_function_code(FunctionName=c['FunctionName'],RevisionId=c['RevisionId'],ZipFile=data);l.get_waiter('function_updated_v2').wait(FunctionName=c['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':90});new=l.get_function_configuration(FunctionName=c['FunctionName']);assert new['CodeSha256']==package['codeSha256'];state['functions'].append({'host':k,'name':new['FunctionName'],'codeSha256':new['CodeSha256'],'revisionId':new['RevisionId']});save();check(k);print(json.dumps({'codePublished':k}),flush=True)
 elif mode=='direct':
  assert len(state['functions'])==3
  selected=json.loads(pathlib.Path('/private/tmp/finance64/selected-staff.private.json').read_text());ids=sorted(x['employeeId'] for x in selected);assert len(ids)==2 and {x['email'] for x in selected}=={'moh.al.daash@gmail.com','g87_a@yahoo.com'}
  for row in selected:
   actor=s.resource('dynamodb').Table('staging-PlatformStaff').get_item(Key={'pk':'EMPLOYEE#'+row['employeeId'],'sk':'PROFILE'},ConsistentRead=True,ProjectionExpression='employeeId,#s,#scope',ExpressionAttributeNames={'#s':'status','#scope':'scope'})['Item'];assert actor['status']=='ACTIVE' and actor['scope']['allRegions'] is True
  state['directEnvironment']={'PLATFORM_ENVIRONMENT':'staging','PLATFORM_WRITE_MODE':'DIRECT','PLATFORM_DIRECT_OPERATOR_IDS':','.join(ids)};save()
  for k in ['wallet','authorizer','staff']:
   c=check(k)
   if any(x['host']==k for x in state['configuration']):continue
   l.update_function_configuration(FunctionName=c['FunctionName'],RevisionId=c['RevisionId'],Environment={'Variables':{**c.get('Environment',{}).get('Variables',{}),**state['directEnvironment']}});l.get_waiter('function_updated_v2').wait(FunctionName=c['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':90});new=l.get_function_configuration(FunctionName=c['FunctionName']);state['configuration'].append({'host':k,'name':new['FunctionName'],'revisionId':new['RevisionId'],'changedEnvironmentKeys':list(state['directEnvironment']),'otherConfigurationPreserved':True});save();check(k);print(json.dumps({'directWriteEnabled':k,'financialRolloutChanged':False}),flush=True)
 elif mode=='frontend':
  assert len(state['configuration'])==3;latest=a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert latest['jobId']==p['frontend']['baseJobId'] and latest['status']=='SUCCEED','FRONTEND_DRIFT';data=(O/'frontend.candidate.zip').read_bytes();assert sha(data)==p['frontend']['codeSha256'];upload=a.create_deployment(appId='d2vmebm1e1n95m',branchName='staging');state['amplify']={'jobId':upload['jobId'],'status':'PENDING'};save();urllib.request.urlopen(urllib.request.Request(upload['zipUploadUrl'],data=data,method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).close();a.start_deployment(appId='d2vmebm1e1n95m',branchName='staging',jobId=upload['jobId'])
  for _ in range(90):
   row=a.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=upload['jobId'])['job']['summary'];assert row['status'] not in ['FAILED','CANCELLED']
   if row['status']=='SUCCEED':break
   time.sleep(3)
  assert row['status']=='SUCCEED';state['amplify']['status']='SUCCEED';save();print(json.dumps(state['amplify']))
 elif mode=='verify':
  assert state.get('amplify',{}).get('status')=='SUCCEED';[check(k) for k in p['packages']]
  with zipfile.ZipFile(O/'frontend.candidate.zip') as z:
   for n in p['frontend']['changedFiles']:
    assert urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n,timeout=30).read()==z.read(n),'HOSTED_DRIFT '+n
  for path in ['/staff/me','/staff/pricing','/staff/commercial']:
   response=l.invoke(FunctionName=base('staff')['FunctionName'],Payload=json.dumps({'httpMethod':'GET','path':path,'headers':{}}).encode());assert not response.get('FunctionError');assert json.loads(response['Payload'].read())['statusCode']==401
  state['verifiedAtUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();state['anonymousRejected']=True;state['hostedFilesMatched']=True;save();print(json.dumps({'directWorkflowReady':True,'financialActivation':False,'anonymousRejected':True}))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['code','direct','frontend','verify']);main(parser.parse_args().mode)
