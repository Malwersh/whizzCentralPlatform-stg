"""Publish the staff page loading repair only; preserve current configuration and application data."""
import pathlib,json,importlib.util,hashlib,base64,urllib.request,time,datetime,zipfile
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/staff-load-fix-66');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
def main():
 p=json.loads((O/'preparation.json').read_text());assert json.loads((O/'browser-test.json').read_text())['directPageLoads'];assert 'pass 177' in (O/'staff-tests.log').read_text() and 'fail 0' in (O/'staff-tests.log').read_text();s=m.session();l=s.client('lambda');a=s.client('amplify');old=json.loads((O/'staff.config.private.json').read_text());c=l.get_function_configuration(FunctionName=old['FunctionName']);assert c['CodeSha256']==old['CodeSha256'] and c['RevisionId']==old['RevisionId'],'STAFF_DRIFT';latest=a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert latest['jobId']==p['frontend']['baseJobId'] and latest['status']=='SUCCEED','FRONTEND_DRIFT'
 state={'part':66,'environment':'Staging','humanWrites':False,'activationPerformed':False,'configurationChanged':False,'functions':[]}
 def save():(O/'publication.json').write_text(json.dumps(state,indent=2))
 data=(O/'staff.candidate.zip').read_bytes();assert sha(data)==p['staff']['candidateCodeSha256'];l.update_function_code(FunctionName=old['FunctionName'],RevisionId=old['RevisionId'],ZipFile=data);l.get_waiter('function_updated_v2').wait(FunctionName=old['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':90});new=l.get_function_configuration(FunctionName=old['FunctionName']);assert new['CodeSha256']==p['staff']['candidateCodeSha256']
 for f in ['Environment','Role','Runtime','Handler','Layers','Timeout','MemorySize','VpcConfig','Architectures']:assert old.get(f)==new.get(f),'CONFIG_CHANGED '+f
 state['functions'].append({'name':new['FunctionName'],'codeSha256':new['CodeSha256'],'revisionId':new['RevisionId'],'configurationPreserved':True});save();print(json.dumps({'staffFixPublished':True}),flush=True)
 latest=a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert latest['jobId']==p['frontend']['baseJobId'],'FRONTEND_DRIFT';data=(O/'frontend.candidate.zip').read_bytes();assert sha(data)==p['frontend']['candidateCodeSha256'];upload=a.create_deployment(appId='d2vmebm1e1n95m',branchName='staging');state['amplify']={'jobId':upload['jobId']};save();urllib.request.urlopen(urllib.request.Request(upload['zipUploadUrl'],data=data,method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).close();a.start_deployment(appId='d2vmebm1e1n95m',branchName='staging',jobId=upload['jobId'])
 for _ in range(90):
  row=a.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=upload['jobId'])['job']['summary'];assert row['status'] not in ['FAILED','CANCELLED']
  if row['status']=='SUCCEED':break
  time.sleep(3)
 assert row['status']=='SUCCEED';state['amplify']['status']='SUCCEED';save()
 with zipfile.ZipFile(O/'frontend.candidate.zip') as z:
  for n in p['frontend']['changedFiles']:
   for _ in range(12):
    if urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n,timeout=30).read()==z.read(n):break
    time.sleep(2)
   else:raise AssertionError('HOSTED_DRIFT '+n)
 state['hostedFilesMatched']=True;state['verifiedAtUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();save();print(json.dumps({'staffPageFixReady':True,'amplifyJob':upload['jobId'],'configurationPreserved':True}))
if __name__=='__main__':main()
