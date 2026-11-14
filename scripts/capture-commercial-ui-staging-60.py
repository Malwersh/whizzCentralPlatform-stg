"""Read-only capture of current Staging hosts and frontend; private rollback artifacts."""
import boto3,pathlib,json,urllib.request,urllib.error,hashlib,base64,os
ROOT=pathlib.Path('/private/tmp/finance60')
def digest(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
def main():
 ROOT.mkdir(mode=0o700,exist_ok=True)
 assert not (ROOT/'inventory.json').exists(),'CAPTURE_ALREADY_COMPLETE'
 s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180'
 lam=s.client('lambda');a=s.client('amplify');rows={}
 for kind,name in [('staff','staging-wizz-staff-service'),('merchant','order-receiver-regional-staging-unified-auth-v4-sam')]:
  f=lam.get_function(FunctionName=name);cfg=f['Configuration'];assert cfg.get('Environment',{}).get('Variables',{}).get('COMMERCIAL_ADMIN_ENABLED')!='true','ADMIN_ALREADY_OPEN'
  data=urllib.request.urlopen(f['Code']['Location'],timeout=60).read();assert digest(data)==cfg['CodeSha256']
  (ROOT/(kind+'.zip')).write_bytes(data);(ROOT/(kind+'.config.private.json')).write_text(json.dumps(cfg))
  rows[kind]={'name':name,'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId']}
 summary=a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert summary['status']=='SUCCEED'
 job=a.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=summary['jobId'])['job'];urls=[step['artifactsUrl'] for step in job['steps'] if step.get('artifactsUrl')];assert urls
 try:
  data=urllib.request.urlopen(urls[-1],timeout=60).read();origin='AMPLIFY_ARTIFACT'
 except urllib.error.HTTPError as e:
  if e.code!=404:raise
  previous=pathlib.Path('/private/tmp/finance56');publication=json.loads((previous/'pricing-publication.json').read_text());preparation=json.loads((previous/'pricing-preparation.json').read_text())
  assert summary['jobId']==publication['amplify']['jobId'] and publication['amplify']['status']=='SUCCEED','UNCORROBORATED_CACHED_RELEASE'
  data=(previous/'frontend.candidate.zip').read_bytes();assert digest(data)==preparation['frontend']['codeSha256'];origin='VERIFIED_PRIOR_PUBLICATION_ARCHIVE'
  import zipfile,io
  with zipfile.ZipFile(io.BytesIO(data)) as z:
   for name in ['pages/merchants.html','pages/promotions.html','merchants.js','assets/js/rbac.js']:
    live=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+name,timeout=30).read();assert live==z.read(name),'HOSTED_FILE_DRIFT: '+name
 (ROOT/'frontend.zip').write_bytes(data);rows['frontend']={'jobId':summary['jobId'],'codeSha256':digest(data),'origin':origin}
 api=s.client('apigateway');resources=api.get_resources(restApiId='ie7z8r4wc0',limit=500)['items'];source=next(x for x in resources if x['path']=='/auth/business-changes');(ROOT/'gateway.private.json').write_text(json.dumps({'source':source,'resources':resources}))
 (ROOT/'inventory.json').write_text(json.dumps(rows,indent=2))
 for p in ROOT.iterdir():p.chmod(0o600)
 print(json.dumps({'captured':list(rows),'frontendJob':summary['jobId'],'awsMutations':0}))
if __name__=='__main__':main()
