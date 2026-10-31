"""Coordinated Staging campaign writer cutover. Scoped grants, live-code CAS, UI then browser write closure."""
import pathlib,json,hashlib,base64,subprocess,datetime,urllib.request,time,argparse
ROOT=pathlib.Path(__file__).resolve().parents[1];R=pathlib.Path('/private/tmp/finance62');STACK='staging-campaign-versioning-access-62'
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
def main(mode):
 import boto3
 c=json.loads(subprocess.check_output(['aws','configure','export-credentials','--profile','Wizz_stg_UserApp','--format','process']));s=boto3.Session(aws_access_key_id=c['AccessKeyId'],aws_secret_access_key=c['SecretAccessKey'],aws_session_token=c['SessionToken'],region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';lam=s.client('lambda');iam=s.client('iam');cf=s.client('cloudformation');amplify=s.client('amplify')
 p=json.loads((R/'preparation.json').read_text());proof=json.loads((R/'dynamodb-test.json').read_text());local=json.loads((R/'local-verification.json').read_text());assert local['allPassed'] and local['browserPassed'];assert all(proof.get(k) for k in ['tableDeleted','platformCreateOnce','staleFundingRejected','concurrentFundingInvalidatesReservation','pausePreservesApprovedVersion','concurrentUsePreserved','ownerUsesExistingGuardedTransaction','staleOwnerFormRejected','ownerControllerAndRetiredStandaloneCounter','deviceSharesMonotonicVersion','platformSharesMerchantVersion','usageOnceWithoutVersionBump','explicitLegacyAdoption'])
 for path,value in {**proof['testedSources'],**local['testedSources']}.items():assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==value,'TESTED_SOURCE_CHANGED '+path
 for k,row in p['packages'].items():assert sha((R/(k+'.candidate.zip')).read_bytes())==row['codeSha256']
 template=json.loads((ROOT/'backend/campaign-versioning-access.staging.json').read_text());assert len(template['Resources'])==3 and all(x['Type']=='AWS::IAM::ManagedPolicy' for x in template['Resources'].values())
 state=json.loads((R/'publication.json').read_text()) if (R/'publication.json').exists() else {'part':62,'environment':'Staging','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'stackName':STACK,'functions':[],'activationPerformed':False}
 def save():(R/'publication.json').write_text(json.dumps(state,indent=2))
 def config(k):
  b=json.loads((R/(k+'.config.private.json')).read_text());live=lam.get_function_configuration(FunctionName=b['FunctionName']);done=next((x for x in state['functions'] if x['name']==b['FunctionName']),None);expected=done or p['base'][k];assert live['CodeSha256']==expected['codeSha256'] and live['RevisionId']==expected['revisionId'],'LIVE_DRIFT '+k
  for f in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig']:assert live.get(f)==b.get(f),'CONFIG_DRIFT '+k+' '+f
  return live
 def latest():return amplify.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0]
 def change(kind,close):
  ch=cf.create_change_set(StackName=STACK,ChangeSetName='campaign62-'+kind,ChangeSetType=kind,TemplateBody=json.dumps(template),Parameters=[{'ParameterKey':'BrowserWritesClosed','ParameterValue':'true' if close else 'false'}],Capabilities=['CAPABILITY_NAMED_IAM']);cf.get_waiter('change_set_create_complete').wait(ChangeSetName=ch['Id'],WaiterConfig={'Delay':2,'MaxAttempts':90});out=cf.describe_change_set(ChangeSetName=ch['Id']);expected=2 if kind=='CREATE' else 1;assert len(out['Changes'])==expected and all(x['ResourceChange']['Action']=='Add' and x['ResourceChange']['ResourceType']=='AWS::IAM::ManagedPolicy' for x in out['Changes']);cf.execute_change_set(ChangeSetName=ch['Id']);cf.get_waiter('stack_create_complete' if kind=='CREATE' else 'stack_update_complete').wait(StackName=STACK,WaiterConfig={'Delay':3,'MaxAttempts':90});return ch['Id']
 def simulate(role,actions,tables,custom=None):
  args={'ActionNames':actions,'ResourceArns':['arn:aws:dynamodb:us-east-1:699561669180:table/'+t for t in tables]};res=iam.simulate_custom_policy(PolicyInputList=[json.dumps(custom)],**args) if custom else iam.simulate_principal_policy(PolicySourceArn=role,**args);return sorted([{'action':r['EvalActionName'],'resource':v['EvalResourceName'],'decision':v.get('EvalResourceDecision',r['EvalDecision'])} for r in res['EvaluationResults'] for v in r.get('ResourceSpecificResults',[r])],key=lambda r:(r['action'],r['resource']))
 if mode=='access':
  for k in ['staff','auth','discount','writer']:config(k)
  assert latest()['jobId']==p['base']['frontend']['jobId'] and latest()['status']=='SUCCEED'
  staffDoc=template['Resources']['StaffCampaignWriter']['Properties']['PolicyDocument'];deny=template['Resources']['BrowserCampaignWrites']['Properties']['PolicyDocument'];actions=['dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem','dynamodb:BatchWriteItem','dynamodb:PartiQLInsert','dynamodb:PartiQLUpdate','dynamodb:PartiQLDelete'];tables=['WhizzMerchants_Discounts','WizzCentral_Platform_Discounts']
  checks=simulate(None,actions,tables,deny);assert all(r['decision']=='explicitDeny' for r in checks)
  checks+=simulate(None,['dynamodb:GetItem','dynamodb:PutItem','dynamodb:DeleteItem','dynamodb:ConditionCheckItem'],tables,staffDoc);assert all(r['decision']=='allowed' for r in checks[-8:]);negative=simulate(None,['dynamodb:UpdateItem','dynamodb:PutItem'],['staging-Wallets','staging-LedgerEntries'],staffDoc);assert all(r['decision']=='implicitDeny' for r in negative);checks+=negative
  state['customPolicyChecks']=checks;state['baselineBrowserReads']={role:simulate(role,['dynamodb:GetItem','dynamodb:Scan'],tables) for role in p['browserRoles']};state['accessChangeSet']=change('CREATE',False);state['accessPrepared']=True;save()
  live=simulate(p['base']['staff']['role'],['dynamodb:GetItem','dynamodb:PutItem','dynamodb:DeleteItem','dynamodb:ConditionCheckItem'],tables);assert all(r['decision']=='allowed' for r in live);state['effectiveWriterChecks']=live;save();print(json.dumps({'accessPrepared':True,'browserCutover':False,'financialActivation':False}));return
 if mode=='code':
  assert state.get('accessPrepared');assert latest()['jobId']==p['base']['frontend']['jobId']
  for k in ['staff','discount','auth','writer']:
   cfg=config(k)
   if any(x['name']==cfg['FunctionName'] for x in state['functions']):continue
   lam.update_function_code(FunctionName=cfg['FunctionName'],RevisionId=cfg['RevisionId'],ZipFile=(R/(k+'.candidate.zip')).read_bytes(),Publish=False);lam.get_waiter('function_updated_v2').wait(FunctionName=cfg['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':90});published_cfg=lam.get_function_configuration(FunctionName=cfg['FunctionName']);assert published_cfg['CodeSha256']==p['packages'][k]['codeSha256'];state['functions'].append({'name':published_cfg['FunctionName'],'codeSha256':published_cfg['CodeSha256'],'revisionId':published_cfg['RevisionId'],'environmentPreserved':True});config(k);save();print(json.dumps({'publishedFunction':k}),flush=True)
  return
 if mode=='frontend':
  assert len(state['functions'])==4 and not state.get('amplify')
  assert latest()['jobId']==p['base']['frontend']['jobId'] and latest()['status']=='SUCCEED'
  for k in ['staff','discount','auth','writer']:config(k)
  for name in ['data-service.js','simplified-campaign-manager.js','pages/promotions.html']:
   import zipfile
   with zipfile.ZipFile(R/'frontend.zip') as z:assert urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+name,timeout=30).read()==z.read(name),'HOSTED_DRIFT '+name
  upload=amplify.create_deployment(appId='d2vmebm1e1n95m',branchName='staging');state['amplify']={'appId':'d2vmebm1e1n95m','branch':'staging','jobId':upload['jobId']};save()
  with urllib.request.urlopen(urllib.request.Request(upload['zipUploadUrl'],data=(R/'frontend.candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=90) as r:assert r.status in [200,201]
  amplify.start_deployment(appId='d2vmebm1e1n95m',branchName='staging',jobId=upload['jobId'])
  for _ in range(90):
   out=amplify.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=upload['jobId'])['job']['summary'];assert out['status'] not in ['FAILED','CANCELLED']
   if out['status']=='SUCCEED':break
   time.sleep(3)
  assert out['status']=='SUCCEED';state['amplify']['status']='SUCCEED';save();print(json.dumps({'frontendJob':upload['jobId'],'status':'SUCCEED'}));return
 if mode=='cutover':
  assert state.get('amplify',{}).get('status')=='SUCCEED' and latest()['jobId']==state['amplify']['jobId']
  import zipfile
  with zipfile.ZipFile(R/'frontend.candidate.zip') as z:
   for name in ['data-service.js','simplified-campaign-manager.js','pages/promotions.html']:
    match=False
    for _ in range(10):
     if urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+name,timeout=30).read()==z.read(name):match=True;break
     time.sleep(3)
    assert match,'CDN_PENDING '+name
  state['browserCutoverChangeSet']=change('UPDATE',True);state['browserWritesClosed']=True;save();print(json.dumps({'browserDirectWritesClosed':True,'financialActivation':False}));return
 if mode=='verify':
  assert state.get('browserWritesClosed');checks={}
  for role in p['browserRoles']:
   checks[role]=simulate(role,['dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem','dynamodb:BatchWriteItem','dynamodb:PartiQLInsert','dynamodb:PartiQLUpdate','dynamodb:PartiQLDelete'],['WhizzMerchants_Discounts','WizzCentral_Platform_Discounts']);assert all(x['decision']=='explicitDeny' for x in checks[role]);assert simulate(role,['dynamodb:GetItem','dynamodb:Scan'],['WhizzMerchants_Discounts','WizzCentral_Platform_Discounts'])==state['baselineBrowserReads'][role]
  for k in ['staff','discount','auth','writer']:config(k)
  state['effectiveBrowserChecks']=checks;state['browserReadsPreserved']=True
  out=lam.invoke(FunctionName=p['base']['staff']['name'],Payload=b'{"httpMethod":"GET","path":"/staff/promotions","headers":{},"queryStringParameters":{"source":"PLATFORM","discountId":"nonexistent62"}}');body=json.loads(out['Payload'].read());assert body['statusCode']==401;state['anonymousPromotionsRejected']=True
  state['verifiedAtUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();save();print(json.dumps({'functionsVerified':4,'browserDenyChecks':sum(map(len,checks.values())),'readsPreserved':True,'anonymousRejected':True,'gatesChanged':False}));return
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('mode',choices=['access','code','frontend','cutover','verify']);main(a.parse_args().mode)
