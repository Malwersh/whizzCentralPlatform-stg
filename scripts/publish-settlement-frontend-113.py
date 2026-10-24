"""Publish only the approved Staging website archive; no feature flag changes."""
import pathlib,json,hashlib,base64,urllib.request,importlib.util,time,datetime
ROOT=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance113');ARGS={'appId':'d2vmebm1e1n95m','branchName':'staging'}
def save(v):
 (O/'frontend-publication.json').write_text(json.dumps(v,indent=2));(O/'frontend-publication.json').chmod(0o600)
def main():
 prep=json.loads((O/'preparation.json').read_text());code=json.loads((O/'code-publication.json').read_text());assert len(code['functions'])==4 and code['activation'] is False
 assert not (O/'frontend-publication.json').exists(),'FRONTEND_PUBLICATION_ALREADY_STARTED'
 payload=(O/'frontend.candidate.zip').read_bytes();assert base64.b64encode(hashlib.sha256(payload).digest()).decode()==prep['packages']['frontend']['codeSha256']
 spec=importlib.util.spec_from_file_location('capture',ROOT/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);s=m.session();amp=s.client('amplify')
 latest=amp.list_jobs(**ARGS,maxResults=1)['jobSummaries'][0];assert latest['jobId']==prep['frontendBase']['jobId'] and latest['status']=='SUCCEED','LIVE_FRONTEND_DRIFT'
 deployment=amp.create_deployment(**ARGS);proof={**ARGS,'jobId':deployment['jobId'],'baseJobId':latest['jobId'],'status':'CREATED','codeSha256':prep['packages']['frontend']['codeSha256'],'activation':False};save(proof)
 urllib.request.urlopen(urllib.request.Request(deployment['zipUploadUrl'],data=payload,method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).close();amp.start_deployment(**ARGS,jobId=deployment['jobId']);proof['status']='STARTED';save(proof)
 for _ in range(60):
  summary=amp.get_job(**ARGS,jobId=deployment['jobId'])['job']['summary'];proof['status']=summary['status'];save(proof)
  if summary['status']=='SUCCEED':proof['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save(proof);print(json.dumps({'frontendJobId':proof['jobId'],'status':'SUCCEED','activation':False}));return
  if summary['status'] in ['FAILED','CANCELLED']:raise RuntimeError('FRONTEND_DEPLOYMENT_FAILED')
  time.sleep(3)
 raise RuntimeError('FRONTEND_DEPLOYMENT_STILL_RUNNING')
if __name__=='__main__':main()
