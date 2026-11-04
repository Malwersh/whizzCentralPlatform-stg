"""Publish legal document management only; no policy records, registration guards or IAM changes."""
import pathlib,json,boto3,urllib.request,time,hashlib,base64
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/customer-legal-344');manifest=json.loads((p/'staff-manifest.json').read_text());base=json.loads((p/'read-only-audit.json').read_text());host=json.loads((p/'hosting-base-meta.json').read_text());hm=json.loads((p/'hosting-manifest.json').read_text())
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');a=s.client('amplify');args={'appId':host['appId'],'branchName':host['branchName']};name=manifest['function'];c=l.get_function_configuration(FunctionName=name)
hashenv=lambda c:hashlib.sha256(json.dumps(c.get('Environment',{}),sort_keys=True).encode()).hexdigest()
assert c['CodeSha256']==manifest['baseCodeSha256'] and c['RevisionId']==base['staff']['revisionId'],'Concurrent staff change'
assert hashenv(c)==base['staff']['environmentHash']
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==host['jobId'],'Concurrent hosting change'
assert all(v=='allowed' for x in json.loads((p/'staff-iam-simulation.json').read_text()) for v in x['decisions'].values())
r={'part':344,'scope':'LEGAL_CMS_ADMIN_ONLY','status':'PUBLISHING','baseStaffCodeSha256':c['CodeSha256'],'businessDataWrites':0,'iamChanges':False,'configurationChanges':False,'policiesPublished':False,'registrationGuardDeployment':False,'nativeAppsInstalled':False,'changedStaffEntries':manifest['changedEntries'],'unrelatedEntriesPreserved':True,'hostingFiles':hm['changes']}
doc=root/'docs/application-legal-cms-publication-344.json';doc.write_text(json.dumps(r,indent=2)+'\n')
l.update_function_code(FunctionName=name,ZipFile=(p/'staff-legal-344.zip').read_bytes(),RevisionId=c['RevisionId'])
for _ in range(50):
 c=l.get_function_configuration(FunctionName=name)
 if c.get('LastUpdateStatus')=='Successful':break
 assert c.get('LastUpdateStatus')!='Failed';time.sleep(2)
assert c['LastUpdateStatus']=='Successful' and c['CodeSha256']==manifest['candidateCodeSha256'] and hashenv(c)==base['staff']['environmentHash']
r['staffCodeSha256']=c['CodeSha256'];r['staffPublished']=True;doc.write_text(json.dumps(r,indent=2)+'\n');print('Staff legal management code published; settings and financial runtimes preserved.',flush=True)
reply=l.invoke(FunctionName=name,Payload=json.dumps({'httpMethod':'GET','path':'/staff/settings/legal-documents/CUSTOMER','headers':{}}).encode());payload=json.loads(reply['Payload'].read());assert not reply.get('FunctionError')and payload['statusCode']==401;r['unauthenticatedSmokeStatus']=401
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==host['jobId'],'Concurrent hosting change'
u=a.create_deployment(**args);r['hostingJobId']=u['jobId'];doc.write_text(json.dumps(r,indent=2)+'\n')
urllib.request.urlopen(urllib.request.Request(u['zipUploadUrl'],data=(p/'hosting-legal-344.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=60).read();a.start_deployment(**args,jobId=u['jobId']);print('Legal CMS hosting upload started: job '+u['jobId'],flush=True)
for _ in range(75):
 status=a.get_job(**args,jobId=u['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
assert status=='SUCCEED',status
for n,digest in hm['hashes'].items():
 for attempt in range(5):
  raw=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?verify=legal344-'+str(attempt),timeout=25).read()
  if hashlib.sha256(raw).hexdigest()==digest:break
  time.sleep(2)
 assert hashlib.sha256(raw).hexdigest()==digest,n
r['status']='ADMIN_CMS_PUBLISHED_VERIFIED_DRAFTS_NOT_PUBLISHED';r['hostedBytesVerified']=True;r['url']='https://staging.d2vmebm1e1n95m.amplifyapp.com/pages/legal-documents.html';doc.write_text(json.dumps(r,indent=2)+'\n');print('PASS: live CMS assets verified; no policy, registration, money or IAM data changed.',flush=True)
