"""Scoped identity/picker patch. No financial writes or payment approvals."""
import boto3,pathlib,urllib.request,zipfile,copy,json,re,time,difflib
R=pathlib.Path(__file__).resolve().parents[1];P=pathlib.Path('/private/tmp/wallet-picker-265');P.mkdir(exist_ok=True)
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');a=s.client('amplify');iam=s.client('iam');name='staging-wizz-wallet-service';f=l.get_function(FunctionName=name);baseSha=f['Configuration']['CodeSha256'];assert baseSha=='m2nfCOkGpN1FrkSinOSqxk24SD3poT5s+zYgmVpv918=','Backend drift'
urllib.request.urlretrieve(f['Code']['Location'],P/'base.zip');changes={n:(R/'backend/wallet-service'/n).read_bytes()for n in ['dist/index.js','dist/financialOwners.js']}
with zipfile.ZipFile(P/'base.zip')as old:
 with zipfile.ZipFile(P/'code.zip','w',zipfile.ZIP_DEFLATED)as new:
  for ent in old.infolist():new.writestr(copy.copy(ent),changes.get(ent.filename,old.read(ent.filename)))
  for n,b in changes.items():
   if n not in old.namelist():new.writestr(n,b)
 with zipfile.ZipFile(P/'code.zip')as new:assert all(old.read(n)==new.read(n)for n in old.namelist()if n not in changes)
args={'appId':'d2vmebm1e1n95m','branchName':'staging'};job=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert job['status']=='SUCCEED';meta=a.get_job(**args,jobId=job['jobId'])['job'];url=next(t['artifactsUrl']for t in meta['steps']if t.get('artifactsUrl'));urllib.request.urlretrieve(url,P/'hosting-base.zip')
with zipfile.ZipFile(P/'hosting-base.zip')as old:
 html=old.read('pages/finance.html').decode();local=(R/'frontend/pages/finance.html').read_text();picker=re.search(r'<label>نوع المستلم<select id="transfer-recipient-type".*?(?=<label>محفظة المستلم)',local).group();anchor='<label>محفظة المستلم<select id="transfer-recipient"';assert html.count(anchor)==1;html=html.replace(anchor,picker+anchor);html,n=re.subn(r'(finance\.js)(?:\?[^"<>]*)?(?=")',r'\1?v=265',html);assert n==1;html,n=re.subn(r'(zaincash-gateway\.js)(?:\?[^"<>]*)?(?=")',r'\1?v=265',html);assert n==1
 changesWeb={'finance.js':(R/'frontend/finance.js').read_bytes(),'zaincash-gateway.js':(R/'frontend/zaincash-gateway.js').read_bytes(),'pages/finance.html':html.encode()}
 # Require live finance base to be the previous tested revision, avoiding an unrelated UI rollback.
 for n in ['finance.js','zaincash-gateway.js']:
  diff=list(difflib.unified_diff(old.read(n).decode().splitlines(),changesWeb[n].decode().splitlines()));(P/(n+'.diff')).write_text('\n'.join(diff));print(n,'diff lines',len(diff),flush=True);assert len(diff)<150,'Unrelated live frontend drift'
 with zipfile.ZipFile(P/'hosting.zip','w',zipfile.ZIP_DEFLATED)as new:
  for ent in old.infolist():new.writestr(copy.copy(ent),changesWeb.get(ent.filename,old.read(ent.filename)))
 with zipfile.ZipFile(P/'hosting.zip')as new:assert all(old.read(n)==new.read(n)for n in old.namelist()if n not in changesWeb)
# Add only the read required for customer display names; preserve existing role policies.
role=f['Configuration']['Role'].split('/')[-1];iam.put_role_policy(RoleName=role,PolicyName='wallet-owner-profile-read-265',PolicyDocument=json.dumps({'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['dynamodb:Scan'],'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/WizzUser_users_staging'}]}))
env=f['Configuration']['Environment']['Variables'];env['CUSTOMERS_TABLE']='WizzUser_users_staging';l.update_function_configuration(FunctionName=name,RevisionId=f['Configuration']['RevisionId'],Environment={'Variables':env});l.get_waiter('function_updated_v2').wait(FunctionName=name);c=l.get_function_configuration(FunctionName=name);l.update_function_code(FunctionName=name,RevisionId=c['RevisionId'],ZipFile=(P/'code.zip').read_bytes());l.get_waiter('function_updated_v2').wait(FunctionName=name);after=l.get_function_configuration(FunctionName=name);print('BACKEND_PUBLISHED',flush=True)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==job['jobId'];up=a.create_deployment(**args);urllib.request.urlopen(urllib.request.Request(up['zipUploadUrl'],data=(P/'hosting.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).close();a.start_deployment(**args,jobId=up['jobId']);print('HOSTING_STARTED',up['jobId'],flush=True)
for _ in range(90):
 status=a.get_job(**args,jobId=up['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
assert status=='SUCCEED',status
for n,b in changesWeb.items():
 for _ in range(10):
  if urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?verify=265',timeout=20).read()==b:break
  time.sleep(2)
 else:raise AssertionError('HOSTED_BYTES '+n)
(R/'frontend/pages/finance.html').write_bytes(changesWeb['pages/finance.html'])
report={'backendBefore':baseSha,'backendAfter':after['CodeSha256'],'hostingBase':job['jobId'],'hostingJob':up['jobId'],'status':'PUBLISHED_VERIFIED','changedModules':['dist/index.js','dist/financialOwners.js'],'unrelatedArtifactFilesPreserved':True,'financialWrites':0,'topupVerified':{'id':'TOPUP_1792886035358_bf49f696','amount':25000,'status':'APPROVED','matchingLedgerEntries':2,'transactionId':'txn_1792886825686_966572dc'},'checks':['TypeScript build','80-account browser picker test','Arabic digit phone search','role filter and stale selection clearing','merchant business name and customer aliases']};(R/'docs/wallet-recipient-picker-265.json').write_text(json.dumps(report,indent=2)+'\n');print('PUBLISHED_VERIFIED',flush=True)
