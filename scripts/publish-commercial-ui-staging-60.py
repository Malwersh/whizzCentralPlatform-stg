"""Publish only closed commercial handlers/UI. No IAM grants, consent, rates or activation."""
import boto3,pathlib,json,hashlib,base64,urllib.request,time,datetime
R=pathlib.Path('/private/tmp/finance60')
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
def main():
 p=json.loads((R/'preparation.json').read_text());proof=json.loads((R/'dynamodb-test.json').read_text());assert p['activation'] is False and p['commercialAdminEnabled'] is False
 assert all(proof.get(k) for k in ['idempotentDraft','concurrentApprovalOnce','canonicalPublication','concurrentOwnershipFence','atomicCampaignPolicyBinding','ownerReadProjection','tableDeleted'])
 s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';lam=s.client('lambda');a=s.client('amplify');api=s.client('apigateway')
 for kind in ['staff','merchant']:
  c=lam.get_function_configuration(FunctionName=p['base'][kind]['name']);assert c['RevisionId']==p['base'][kind]['revisionId'] and c['CodeSha256']==p['base'][kind]['codeSha256'],'LIVE_DRIFT';assert c.get('Environment',{}).get('Variables',{}).get('COMMERCIAL_ADMIN_ENABLED')!='true'
 for kind,package in p['packages'].items():assert sha((R/(kind+'.candidate.zip')).read_bytes())==package['codeSha256']
 current=a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert current['jobId']==p['base']['frontend']['jobId'] and current['status']=='SUCCEED'
 state={'part':60,'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'published':True,'activationPerformed':False,'commercialAdminEnabled':False,'functions':[]}
 def save(): (R/'publication.json').write_text(json.dumps(state,indent=2))
 for kind in ['staff','merchant']:
  base=json.loads((R/(kind+'.config.private.json')).read_text());name=base['FunctionName'];cfg=lam.get_function_configuration(FunctionName=name);assert cfg['RevisionId']==base['RevisionId']
  lam.update_function_code(FunctionName=name,RevisionId=cfg['RevisionId'],ZipFile=(R/(kind+'.candidate.zip')).read_bytes(),Publish=False);lam.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':90});cfg=lam.get_function_configuration(FunctionName=name);assert cfg['CodeSha256']==p['packages'][kind]['codeSha256']
  for field in ['Environment','Role','Runtime','Handler','Layers','Timeout','MemorySize','VpcConfig','Architectures','TracingConfig']:assert cfg.get(field)==base.get(field),field
  state['functions'].append({'name':name,'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'environmentPreserved':True});save();print(json.dumps({'publishedClosed':kind}),flush=True)
 # Closed handler answers before any credential processing or DB read. No owner consent is fabricated.
 r=lam.invoke(FunctionName=p['base']['staff']['name'],Payload=json.dumps({'action':'commercial_owner','accessToken':'not-a-token','httpMethod':'POST','input':{}}).encode());out=json.loads(r['Payload'].read());assert out=={'statusCode':503,'code':'COMMERCIAL_MANAGEMENT_DISABLED'};state['closedOwnerHandlerVerified']=True;save()
 rest='ie7z8r4wc0';rows=api.get_resources(restApiId=rest,limit=500)['items'];assert not any(r['path']=='/auth/commercial-agreements' for r in rows),'ROUTE_ALREADY_EXISTS_REVIEW_REQUIRED';source=next(r for r in rows if r['path']=='/auth/business-changes');parent=next(r for r in rows if r['path']=='/auth');stage=api.get_stage(restApiId=rest,stageName='staging');state['gateway']={'previousDeploymentId':stage['deploymentId']};save()
 target=api.create_resource(restApiId=rest,parentId=parent['id'],pathPart='commercial-agreements')['id'];state['gateway']['resourceId']=target;save()
 for method in ['GET','POST','OPTIONS']:
  old=api.get_method(restApiId=rest,resourceId=source['id'],httpMethod=method);kwargs={k:old[k] for k in ['authorizationType','authorizerId','authorizationScopes','apiKeyRequired','requestParameters','requestModels','requestValidatorId'] if k in old};api.put_method(restApiId=rest,resourceId=target,httpMethod=method,**kwargs)
  i=old['methodIntegration'];kwargs={k:i[k] for k in ['type','uri','connectionType','connectionId','credentials','requestParameters','requestTemplates','passthroughBehavior','cacheKeyParameters','contentHandling','timeoutInMillis'] if k in i}
  if 'httpMethod' in i:kwargs['integrationHttpMethod']=i['httpMethod']
  api.put_integration(restApiId=rest,resourceId=target,httpMethod=method,**kwargs)
  for status,response in old.get('methodResponses',{}).items():api.put_method_response(restApiId=rest,resourceId=target,httpMethod=method,statusCode=status,**{k:response[k] for k in ['responseParameters','responseModels'] if k in response})
  for status,response in i.get('integrationResponses',{}).items():api.put_integration_response(restApiId=rest,resourceId=target,httpMethod=method,statusCode=response['statusCode'],**{k:response[k] for k in ['selectionPattern','responseParameters','responseTemplates','contentHandling'] if k in response})
 deployment=api.create_deployment(restApiId=rest,stageName='staging',description='Part60 closed commercial agreement owner route; no financial activation');state['gateway']['deploymentId']=deployment['id'];save()
 current=a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert current['jobId']==p['base']['frontend']['jobId']
 upload=a.create_deployment(appId='d2vmebm1e1n95m',branchName='staging');state['amplify']={'appId':'d2vmebm1e1n95m','branch':'staging','jobId':upload['jobId']};save()
 with urllib.request.urlopen(urllib.request.Request(upload['zipUploadUrl'],data=(R/'frontend.candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=90) as response:assert response.status in [200,201]
 a.start_deployment(appId='d2vmebm1e1n95m',branchName='staging',jobId=upload['jobId'])
 for n in range(90):
  j=a.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=upload['jobId'])['job']['summary'];assert j['status'] not in ['FAILED','CANCELLED']
  if j['status']=='SUCCEED':break
  time.sleep(3)
 assert j['status']=='SUCCEED';state['amplify']['status']='SUCCEED';save();print(json.dumps(state))
if __name__=='__main__':main()
