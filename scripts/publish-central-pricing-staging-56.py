"""Publish reviewed pricing overlay only, with code/job CAS and unchanged runtime config."""
import base64, datetime, hashlib, json, pathlib, time, urllib.request, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
def sha(data):return base64.b64encode(hashlib.sha256(data).digest()).decode()
def main():
 import boto3
 r=pathlib.Path('/private/tmp/finance56');p=json.loads((r/'pricing-preparation.json').read_text());test=json.loads((r/'pricing-dynamodb.json').read_text())
 assert all(test.get(k) for k in ['atomicDraft','selfApprovalRejected','revokedRequesterRejected','independentPublication','repeatedPublicationRejected','sameEngineSimulation','tableDeleted'])
 assert json.loads((r/'browser.log').read_text())['sameEngineSimulation']
 s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180'
 lam=s.client('lambda');a=s.client('amplify');ddb=s.resource('dynamodb').Table('staging-PlatformStaff')
 def pricing():return ddb.get_item(Key={'pk':'OPERATIONAL_SETTINGS#DELIVERY_PRICING','sk':'CURRENT'},ConsistentRead=True,ProjectionExpression='#v',ExpressionAttributeNames={'#v':'version'}).get('Item')
 before=pricing();assert before is None,'PRICING_CHANGED_REQUIRES_REVIEW'
 base=json.loads((r/'staff.config.private.json').read_text());cfg=lam.get_function_configuration(FunctionName=base['FunctionName'])
 assert cfg['RevisionId']==base['RevisionId'] and cfg['CodeSha256']==base['CodeSha256']
 latest=a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert latest['jobId']==p['base']['frontend']['jobId'] and latest['status']=='SUCCEED'
 for kind in ['staff','frontend']:assert sha((r/(kind+'.candidate.zip')).read_bytes())==p[kind]['codeSha256']
 # Retain the captured live archives as rollback; never restore obsolete gates or config.
 lam.update_function_code(FunctionName=base['FunctionName'],RevisionId=cfg['RevisionId'],ZipFile=(r/'staff.candidate.zip').read_bytes(),Publish=False)
 lam.get_waiter('function_updated_v2').wait(FunctionName=base['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':90})
 cfg=lam.get_function_configuration(FunctionName=base['FunctionName']);assert cfg['CodeSha256']==p['staff']['codeSha256']
 for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Layers','VpcConfig','Architectures','TracingConfig']:assert cfg.get(k)==base.get(k),k
 state={'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'functions':[{'name':cfg['FunctionName'],'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'environmentPreserved':True}],'activation':False}
 (r/'pricing-publication.json').write_text(json.dumps(state,indent=2))
 print(json.dumps({'staffPublished':True,'environmentPreserved':True}),flush=True)
 latest=a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert latest['jobId']==p['base']['frontend']['jobId']
 deployment=a.create_deployment(appId='d2vmebm1e1n95m',branchName='staging');job=deployment['jobId']
 request=urllib.request.Request(deployment['zipUploadUrl'],data=(r/'frontend.candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'})
 with urllib.request.urlopen(request,timeout=90) as response:assert response.status in [200,201]
 a.start_deployment(appId='d2vmebm1e1n95m',branchName='staging',jobId=job)
 state['amplify']={'appId':'d2vmebm1e1n95m','branch':'staging','jobId':job};(r/'pricing-publication.json').write_text(json.dumps(state,indent=2))
 for _ in range(90):
  summary=a.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=job)['job']['summary']
  if summary['status']=='SUCCEED':break
  assert summary['status'] not in ['FAILED','CANCELLED'],'AMPLIFY_FAILED'
  time.sleep(4)
 assert summary['status']=='SUCCEED';state['amplify']['status']='SUCCEED';assert pricing()==before
 state['livePricingUnchanged']=True;(r/'pricing-publication.json').write_text(json.dumps(state,indent=2));print(json.dumps(state))
if __name__=='__main__':main()
