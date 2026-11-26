"""Publish review forms and enable authenticated commercial administration only; financial rollout stays closed."""
import pathlib,json,hashlib,base64,datetime,importlib.util,argparse,urllib.request,zipfile,io,time,uuid
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path('/private/tmp/finance64');STACK='staging-commercial-owner-access-64'
sp=importlib.util.spec_from_file_location('capture',ROOT/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main(mode):
 s=m.session();lam=s.client('lambda');iam=s.client('iam');a=s.client('amplify');cf=s.client('cloudformation');prep=json.loads((OUT/'preparation.json').read_text());template=json.loads((ROOT/'backend/commercial-sample-access.staging.json').read_text())
 for p,h in prep['sourceHashes'].items():assert hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h,'SOURCE_CHANGED '+p
 assert json.loads((OUT/'browser-sample.log').read_text())['realWrites'] is False
 assert '"realWrites":false' in (OUT/'browser-pricing.log').read_text() and 'passed' in (OUT/'browser-commercial.log').read_text()
 assert 'pass 25' in (OUT/'admin-tests.log').read_text() and 'fail 0' in (OUT/'admin-tests.log').read_text()
 assert base64.b64encode(hashlib.sha256((OUT/'frontend.candidate.zip').read_bytes()).digest()).decode()==prep['frontend']['candidateCodeSha256']
 state=json.loads((OUT/'publication.json').read_text()) if (OUT/'publication.json').exists() else {'part':64,'environment':'Staging','financialActivationPerformed':False,'activationPerformed':False,'humanRoleChangesApplied':False,'consentOrApprovalWritten':False,'configuration':[]}
 def save():(OUT/'publication.json').write_text(json.dumps(state,indent=2))
 def latest():return a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0]
 def base(k):return json.loads((OUT/('staff.latest.config.private.json' if k=='staff' else k+'.config.private.json')).read_text())
 def config(k):
  old=base(k);live=lam.get_function_configuration(FunctionName=old['FunctionName']);done=next((x for x in state['configuration'] if x['host']==k),None);assert live['CodeSha256']==old['CodeSha256'];assert live['RevisionId']==(done['revisionId'] if done else old['RevisionId']),'CONFIG_DRIFT '+k
  for f in ['Role','Runtime','Handler','Timeout','MemorySize','Architectures','Layers','VpcConfig']:assert live.get(f)==old.get(f)
  expected={**old.get('Environment',{}).get('Variables',{}),**({'COMMERCIAL_ADMIN_ENABLED':'true'} if done else {})};assert live.get('Environment',{}).get('Variables',{})==expected
  return live
 if mode=='access':
  doc=template['Resources']['MerchantOwnerCommercialInvoke']['Properties']['PolicyDocument'];resource=doc['Statement'][0]['Resource'][0];assert resource=='arn:aws:lambda:us-east-1:699561669180:function:staging-wizz-staff-service'
  custom=[]
  for action,arn,expected in [('lambda:InvokeFunction',resource,'allowed'),('lambda:InvokeFunction',resource+'-other','implicitDeny'),('dynamodb:UpdateItem','arn:aws:dynamodb:us-east-1:699561669180:table/staging-Wallets','implicitDeny')]:
   r=iam.simulate_custom_policy(PolicyInputList=[json.dumps(doc)],ActionNames=[action],ResourceArns=[arn])['EvaluationResults'][0];assert r['EvalDecision']==expected;custom.append({'action':action,'resource':arn,'decision':expected})
  for k in ['staff','merchant']:config(k)
  change=cf.create_change_set(StackName=STACK,ChangeSetName='commercial64-access',ChangeSetType='CREATE',TemplateBody=json.dumps(template),Capabilities=['CAPABILITY_NAMED_IAM']);cf.get_waiter('change_set_create_complete').wait(ChangeSetName=change['Id'],WaiterConfig={'Delay':2,'MaxAttempts':90});plan=cf.describe_change_set(ChangeSetName=change['Id']);assert len(plan['Changes'])==1 and plan['Changes'][0]['ResourceChange']['Action']=='Add';cf.execute_change_set(ChangeSetName=change['Id']);cf.get_waiter('stack_create_complete').wait(StackName=STACK,WaiterConfig={'Delay':3,'MaxAttempts':90});state.update(accessStack=STACK,accessChangeSet=change['Id'],customPolicyChecks=custom,accessPrepared=True);save()
  d=iam.simulate_principal_policy(PolicySourceArn=base('merchant')['Role'],ActionNames=['lambda:InvokeFunction'],ResourceArns=[resource])['EvaluationResults'][0]['EvalDecision'];assert d=='allowed';state['effectiveOwnerInvoke']='allowed';save();print(json.dumps({'ownerInvokeAllowed':True,'financialGrantsAdded':False}));return
 if mode=='frontend':
  assert state.get('accessPrepared') and latest()['jobId']==prep['frontend']['baseJobId'] and latest()['status']=='SUCCEED';assert not state.get('amplify')
  upload=a.create_deployment(appId='d2vmebm1e1n95m',branchName='staging');state['amplify']={'appId':'d2vmebm1e1n95m','branch':'staging','jobId':upload['jobId']};save()
  urllib.request.urlopen(urllib.request.Request(upload['zipUploadUrl'],data=(OUT/'frontend.candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).close();a.start_deployment(appId='d2vmebm1e1n95m',branchName='staging',jobId=upload['jobId'])
  for _ in range(90):
   row=a.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=upload['jobId'])['job']['summary'];assert row['status'] not in ['FAILED','CANCELLED']
   if row['status']=='SUCCEED':break
   time.sleep(3)
  assert row['status']=='SUCCEED';state['amplify']['status']='SUCCEED';save();print(json.dumps({'frontendJob':upload['jobId'],'status':'SUCCEED'}));return
 if mode=='enable-admin':
  assert state.get('amplify',{}).get('status')=='SUCCEED'
  for k in ['staff','merchant']:
   current=config(k)
   if any(x['host']==k for x in state['configuration']):continue
   env={**current.get('Environment',{}).get('Variables',{}),'COMMERCIAL_ADMIN_ENABLED':'true'};lam.update_function_configuration(FunctionName=current['FunctionName'],RevisionId=current['RevisionId'],Environment={'Variables':env});lam.get_waiter('function_updated_v2').wait(FunctionName=current['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':90});new=lam.get_function_configuration(FunctionName=current['FunctionName']);state['configuration'].append({'host':k,'name':new['FunctionName'],'codeSha256':new['CodeSha256'],'revisionId':new['RevisionId'],'changedEnvironmentKeys':['COMMERCIAL_ADMIN_ENABLED'],'commercialAdminEnabled':True,'otherConfigurationPreserved':True});save();config(k);print(json.dumps({'commercialAdminEnabled':k,'financialActivation':False}),flush=True)
  return
 if mode=='verify':
  assert len(state['configuration'])==2; observed=latest(); assert observed['status']=='SUCCEED'; state['observedFrontendJobId']=observed['jobId']; [config(k) for k in ['staff','merchant']]
  with zipfile.ZipFile(OUT/'frontend.candidate.zip') as z:
   for n in prep['frontend']['changedFiles']:
    for attempt in range(10):
     if urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n,timeout=30).read()==z.read(n):break
     time.sleep(3)
    else:raise AssertionError('CDN_NOT_MATCHED '+n)
  event={'action':'commercial_owner','httpMethod':'GET','accessToken':'invalid-probe-no-identity','input':{'businessId':'probe64'}};reply=lam.invoke(FunctionName=base('staff')['FunctionName'],Payload=json.dumps(event).encode());assert not reply.get('FunctionError');body=json.loads(reply['Payload'].read());assert body['statusCode']==401;state['anonymousOwnerRejected']=True
  name='staging-commercial-owner-invoke-test-64-'+uuid.uuid4().hex[:8];created=False;log=s.client('logs');proof=None
  try:
   z=io.BytesIO()
   with zipfile.ZipFile(z,'w',zipfile.ZIP_DEFLATED) as out:out.writestr('index.js',(OUT/'owner-probe-index.js').read_bytes())
   lam.create_function(FunctionName=name,Runtime='nodejs22.x',Role=base('merchant')['Role'],Handler='index.handler',Code={'ZipFile':z.getvalue()},Timeout=20,MemorySize=128);created=True;lam.get_waiter('function_active_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':60});reply=lam.invoke(FunctionName=name,Payload=b'{}');assert not reply.get('FunctionError'),'ROLE_PROBE_FAILED';proof=json.loads(reply['Payload'].read());assert proof['roleInvokeAllowed'] and proof['targetAnonymousRejected'];state['actualMerchantRoleProbe']=proof
  finally:
   if created:
    lam.delete_function(FunctionName=name)
    try:log.delete_log_group(logGroupName='/aws/lambda/'+name)
    except log.exceptions.ResourceNotFoundException:pass
   state['temporaryProbeDeleted']=created;save()
  assert proof;state['verifiedAtUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();save();print(json.dumps({'commercialAdministrationReady':True,'ownerInvokeTestedWithActualRole':True,'anonymousRejected':True,'financialActivation':False}));return
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['access','frontend','enable-admin','verify']);main(parser.parse_args().mode)
