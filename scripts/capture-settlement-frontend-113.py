"""Read-only latest hosted artifact and merchant API routing inventory."""
import pathlib,json,urllib.request,urllib.error,hashlib,importlib.util,zipfile,io
ROOT=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance113')
def main():
 spec=importlib.util.spec_from_file_location('capture',ROOT/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);s=m.session()
 amp=s.client('amplify');job=amp.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert job['status']=='SUCCEED'
 detail=amp.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=job['jobId'])['job'];urls=[step['artifactsUrl'] for step in detail['steps'] if step.get('artifactsUrl')];assert urls
 data=None;origin='AMPLIFY_ARTIFACT'
 for url in reversed(urls):
  try:data=urllib.request.urlopen(url,timeout=60).read();break
  except urllib.error.HTTPError as e:
   if e.code!=404:raise
 if data is None:
  prior=pathlib.Path('/private/tmp/notification100');publication=json.loads((prior/'ui-publication.json').read_text());assert publication['jobId']==job['jobId'],'CACHED_RELEASE_JOB_MISMATCH'
  data=(prior/'frontend.candidate.zip').read_bytes();origin='PRIOR_PUBLICATION_ARCHIVE_WITH_HOSTED_FILE_CHECKS'
 z=zipfile.ZipFile(io.BytesIO(data));assert 'pages/finance.html' in z.namelist()
 (O/'frontend.zip').write_bytes(data);(O/'frontend.zip').chmod(0o600)
 verified=[]
 for name in ['pages/finance.html','pages/merchants.html','assets/js/rbac.js']:
  hosted=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+name,timeout=30).read();assert hosted==z.read(name),'HOSTED_ARTIFACT_DRIFT';verified.append(name)
 doc={'appId':'d2vmebm1e1n95m','branchName':'staging','jobId':job['jobId'],'artifactSha256':hashlib.sha256(data).hexdigest(),'origin':origin,'hostedFilesVerified':verified};(O/'frontend-inventory.json').write_text(json.dumps(doc,indent=2));(O/'frontend-inventory.json').chmod(0o600)
 api=s.client('apigateway');resources=[]
 for page in api.get_paginator('get_resources').paginate(restApiId='ie7z8r4wc0',embed=['methods']):resources.extend(page['items'])
 (O/'merchant-api-resources.private.json').write_text(json.dumps(resources,indent=2,default=str));(O/'merchant-api-resources.private.json').chmod(0o600)
 print(json.dumps({'frontendJobId':job['jobId'],'hostedFilesVerified':verified,'merchantScheduleRouteExists':any(r['path']=='/auth/settlement-schedules' for r in resources),'awsMutations':0}))
if __name__=='__main__':main()
