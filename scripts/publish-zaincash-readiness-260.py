"""Scoped staging infrastructure/code publication. Never submits, approves or settles a payment.
Run after local verification; preserve captured deployment entries and concurrent hosting work.
"""
import pathlib,json,zipfile,copy,hashlib,base64,urllib.request,subprocess,time,difflib,boto3,re
R=pathlib.Path(__file__).resolve().parents[1];P=R/'backend/.tmp/zaincash-260';P.mkdir(parents=True,exist_ok=True)
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');iam=s.client('iam');api=s.client('apigateway');events=s.client('events');a=s.client('amplify');API='z14s5f8oxh';REGION='us-east-1';ACCOUNT='699561669180'
assert s.client('sts').get_caller_identity()['Account']==ACCOUNT
sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
record={'status':'PREPARING','scope':'STAGING_ONLY','livePaymentsEnabled':False,'actualPaymentOrBalanceActions':False,'functions':{},'routes':[]}
report=R/'docs/zaincash-readiness-publication-260.json'
def save():report.write_text(json.dumps(record,indent=2)+'\n')
assert 'fail 0' in pathlib.Path('/private/tmp/zc-tests.log').read_text()
assert 'fail 0' in pathlib.Path('/private/tmp/zc-deletion-tests.log').read_text()
assert 'OK' in pathlib.Path('/private/tmp/zc-auth-tests.log').read_text()
assert 'All tests passed!' in pathlib.Path('/private/tmp/zc-flutter-tests.log').read_text()
assert 'PASS' in pathlib.Path('/private/tmp/zc-browser.log').read_text()

def patch_zip(label,changes):
 with zipfile.ZipFile(P/(label+'-base.zip')) as old:
  with zipfile.ZipFile(P/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as new:
   for item in old.infolist():new.writestr(copy.copy(item),changes.get(item.filename,old.read(item.filename)))
   for name,data in changes.items():
    if name not in old.namelist():new.writestr(name,data)
  with zipfile.ZipFile(P/(label+'-candidate.zip'))as new:assert all(old.read(n)==new.read(n)for n in old.namelist()if n not in changes)
 return (P/(label+'-candidate.zip')).read_bytes()

changes={
 'wallet':{n:(R/'backend/wallet-service'/n).read_bytes() for n in ['dist/index.js','dist/topupService.js','dist/zaincashGateway.js']},
 'authorizer':{n:(R/'backend/wallet-service/authorizer_lambda'/n).read_bytes()for n in ['authorizer.py','staff_policy.py']},
 'requests':{n:(R/'backend/account-deletion'/n).read_bytes()for n in ['driver-evidence.js','driver-lock.js']},
 'worker':{n:(R/'backend/account-deletion'/n).read_bytes()for n in ['driver-cleanup.js','customer-cleanup.js']}}
# Captured base must match tracked sources for every replaced old file; otherwise review drift first.
with zipfile.ZipFile(P/'wallet-base.zip')as old:
 for n in ['index','topupService']:assert old.read('dist/'+n+'.js').decode().split('//# sourceMappingURL')[0].strip()==(P/('head-'+n+'.js')).read_text().strip(),n+' BASE_DRIFT'
 for n in ['db','fundingService','staffAccess','utils','walletNotifications']:assert old.read('dist/'+n+'.js')==(R/('backend/wallet-service/dist/'+n+'.js')).read_bytes(),n+' DEPENDENCY_DRIFT'
for label in ['authorizer','requests','worker']:
 with zipfile.ZipFile(P/(label+'-base.zip'))as old:
  for n in changes[label]:
   folder='backend/wallet-service/authorizer_lambda'if label=='authorizer'else'backend/account-deletion'
   assert old.read(n)==subprocess.check_output(['git','show','HEAD:'+folder+'/'+n],cwd=R),label+'/'+n+' BASE_DRIFT'
raws={k:patch_zip(k,v)for k,v in changes.items()}
# Tight additive policies; do not rewrite the existing role policy documents.
walletConfig=json.loads((P/'wallet-config.json').read_text());requestConfig=json.loads((P/'requests-config.json').read_text())
policies=[(walletConfig['Role'].split('/')[-1],'ZaincashGateway260',{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['secretsmanager:CreateSecret','secretsmanager:GetSecretValue'],'Resource':f'arn:aws:secretsmanager:{REGION}:{ACCOUNT}:secret:wizz/staging/payments/zaincash/gateway-*'}]}),(requestConfig['Role'].split('/')[-1],'ZaincashFundingDeletionFence260',{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'dynamodb:ConditionCheckItem','Resource':f'arn:aws:dynamodb:{REGION}:{ACCOUNT}:table/staging-IdempotencyKeys','Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ZC#ACTIVE#*']}}}]})]
record['policies']=[{'role':role,'name':name,'document':policy}for role,name,policy in policies];save()
for role,name,policy in policies:iam.put_role_policy(RoleName=role,PolicyName=name,PolicyDocument=json.dumps(policy))
# Publish deletion guards before allowing gateway creation.
for label in ['requests','worker','authorizer','wallet']:
 before=json.loads((P/(label+'-config.json')).read_text());name=before['FunctionName'];current=l.get_function_configuration(FunctionName=name)
 if current['CodeSha256'] not in [before['CodeSha256'],sha(raws[label])]:
  # ZIP timestamps can differ on a resumed publication. Accept only byte-identical entries.
  live=l.get_function(FunctionName=name);urllib.request.urlretrieve(live['Code']['Location'],P/(label+'-resume.zip'))
  with zipfile.ZipFile(P/(label+'-resume.zip'))as x,zipfile.ZipFile(P/(label+'-candidate.zip'))as y:
   assert set(x.namelist())==set(y.namelist())and all(x.read(n)==y.read(n)for n in x.namelist()),label+' LIVE_DRIFT'
  raws[label]=(P/(label+'-resume.zip')).read_bytes()
 if label=='wallet':
  variables={**current['Environment']['Variables'],'ZAINCASH_RETURN_URL':'https://staging.d2vmebm1e1n95m.amplifyapp.com/pages/zaincash-return.html','ZAINCASH_WEBHOOK_URL':f'https://{API}.execute-api.{REGION}.amazonaws.com/staging/wallet/funding/zaincash/notification'}
  if variables!=current['Environment']['Variables']:
   l.update_function_configuration(FunctionName=name,RevisionId=current['RevisionId'],Environment={'Variables':variables});l.get_waiter('function_updated_v2').wait(FunctionName=name);current=l.get_function_configuration(FunctionName=name)
 if current['CodeSha256']!=sha(raws[label]):
  l.update_function_code(FunctionName=name,RevisionId=current['RevisionId'],ZipFile=raws[label]);l.get_waiter('function_updated_v2').wait(FunctionName=name)
 after=l.get_function_configuration(FunctionName=name);assert after['CodeSha256']==sha(raws[label])
 for k in ['Handler','Role','Runtime','Timeout','MemorySize','Architectures']:assert before.get(k)==after.get(k),label+'/'+k
 record['functions'][label]={'name':name,'before':before['CodeSha256'],'after':after['CodeSha256'],'changedFiles':list(changes[label]),'unrelatedEntriesPreserved':True};save();print(label,'PUBLISHED',flush=True)

def invoke_role(name,principal):
 trust={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':principal},'Action':'sts:AssumeRole'}]}
 try:r=iam.create_role(RoleName=name,AssumeRolePolicyDocument=json.dumps(trust))['Role']
 except iam.exceptions.EntityAlreadyExistsException:
  r=iam.get_role(RoleName=name)['Role'];assert r['AssumeRolePolicyDocument']==trust,'ROLE_TRUST_DRIFT'
 policy={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'lambda:InvokeFunction','Resource':walletConfig['FunctionArn']}]}
 iam.put_role_policy(RoleName=name,PolicyName='InvokeWalletOnly',PolicyDocument=json.dumps(policy));return r['Arn']
apiRoleArn=invoke_role('staging-zaincash-api-invoke','apigateway.amazonaws.com')
scheduleRoleArn=invoke_role('staging-zaincash-scheduler-invoke','scheduler.amazonaws.com')
record['invocationRoles']={'api':apiRoleArn,'scheduler':scheduleRoleArn,'scope':'Invoke wallet Lambda only; existing resource policy unchanged'};save()
resources={r['path']:r for r in api.get_resources(restApiId=API,limit=500)['items']};authorizer=api.get_authorizers(restApiId=API)['items'];authId=next(x['id']for x in authorizer if x['name']=='WalletAuthorizer');walletArn=walletConfig['FunctionArn']
def resource(path):
 if path in resources:return resources[path]['id']
 parent,part=path.rsplit('/',1);pid=resource(parent or '/')
 r=api.create_resource(restApiId=API,parentId=pid,pathPart=part);resources[path]=r;return r['id']
paths={
 '/wallet/funding/zaincash/config':['GET'],'/wallet/funding/zaincash/payments':['GET'],'/wallet/funding/zaincash/payment':['POST'],'/wallet/funding/zaincash/check':['POST'],'/wallet/funding/zaincash/notification':['POST'],
 '/wallet/funding/admin/zaincash':['GET','PUT'],'/wallet/funding/admin/zaincash/test':['POST'],'/wallet/funding/admin/zaincash/import-uat':['POST'],'/wallet/funding/admin/zaincash/accept':['POST'],'/wallet/funding/admin/zaincash/pilot':['POST'],'/wallet/funding/admin/zaincash/recover':['POST'],'/wallet/funding/admin/zaincash/resolve-uncreated':['POST'],'/wallet/funding/admin/zaincash/payments':['GET']}
for path,methods in paths.items():
 rid=resource(path)
 for method in methods:
  public=path.endswith('/notification')
  try:existing=api.get_method(restApiId=API,resourceId=rid,httpMethod=method)
  except api.exceptions.NotFoundException:existing=None
  if existing:assert existing['authorizationType']==('NONE'if public else'CUSTOM') and (public or existing['authorizerId']==authId)
  else:api.put_method(restApiId=API,resourceId=rid,httpMethod=method,authorizationType='NONE'if public else'CUSTOM',**({}if public else{'authorizerId':authId}),apiKeyRequired=False)
  api.put_integration(restApiId=API,resourceId=rid,httpMethod=method,type='AWS_PROXY',integrationHttpMethod='POST',uri=f'arn:aws:apigateway:{REGION}:lambda:path/2015-03-31/functions/{walletArn}/invocations',credentials=apiRoleArn)
  record['routes'].append(method+' '+path)
 try:api.get_method(restApiId=API,resourceId=rid,httpMethod='OPTIONS')
 except api.exceptions.NotFoundException:api.put_method(restApiId=API,resourceId=rid,httpMethod='OPTIONS',authorizationType='NONE')
 api.put_integration(restApiId=API,resourceId=rid,httpMethod='OPTIONS',type='MOCK',requestTemplates={'application/json':'{"statusCode":200}'})
 headers={'method.response.header.Access-Control-Allow-Origin':"'https://staging.d2vmebm1e1n95m.amplifyapp.com'",'method.response.header.Access-Control-Allow-Headers':"'Content-Type,Authorization'",'method.response.header.Access-Control-Allow-Methods':"'GET,POST,PUT,OPTIONS'"}
 try:api.put_method_response(restApiId=API,resourceId=rid,httpMethod='OPTIONS',statusCode='200',responseParameters={k:False for k in headers})
 except api.exceptions.ConflictException:api.update_method_response(restApiId=API,resourceId=rid,httpMethod='OPTIONS',statusCode='200',patchOperations=[{'op':'add','path':'/responseParameters/'+k,'value':'false'}for k in headers])
 api.put_integration_response(restApiId=API,resourceId=rid,httpMethod='OPTIONS',statusCode='200',responseParameters=headers,responseTemplates={'application/json':''})
api.create_deployment(restApiId=API,stageName='staging',description='ZainCash wallet readiness260, live activation remains gated')
scheduler=sessionsScheduler=s.client('scheduler')
argsSchedule={'Name':'staging-zaincash-wallet-reconciliation','ScheduleExpression':'rate(1 minute)','FlexibleTimeWindow':{'Mode':'OFF'},'State':'ENABLED','Target':{'Arn':walletArn,'RoleArn':scheduleRoleArn,'Input':json.dumps({'source':'aws.events','detail':{'worker':'zaincash'}}),'RetryPolicy':{'MaximumRetryAttempts':2,'MaximumEventAgeInSeconds':300}}}
try:scheduler.create_schedule(**argsSchedule)
except scheduler.exceptions.ConflictException:scheduler.update_schedule(**argsSchedule)
record['schedule']={'scheduler':'staging-zaincash-wallet-reconciliation','enabled':True};record['status']='BACKEND_PUBLISHED';save();print('API_AND_WORKER_PUBLISHED',flush=True)
# Overlay only these frontend diffs onto the CURRENT hosting artifact. Fail on overlap.
args={'appId':'d2vmebm1e1n95m','branchName':'staging'};job=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert job['status']=='SUCCEED'
meta=a.get_job(**args,jobId=job['jobId'])['job'];url=next(st['artifactsUrl']for st in meta['steps']if st.get('artifactsUrl'));urllib.request.urlretrieve(url,P/'hosting-base.zip')
def apply_tracked_diff(name,base):
 head=subprocess.check_output(['git','show','HEAD:frontend/'+name],cwd=R).decode();local=(R/'frontend'/name).read_text();old=head.splitlines(True);new=local.splitlines(True);text=base.decode()
 if text==local:return base
 if name=='pages/finance.html':
  # Current hosted page has newer shared shell styles and timeout cache tags.
  # Preserve those and alter only gateway anchors/buttons/script references.
  for before,after in [('<section id="sandbox-section"','<section id="zaincash-gateway"></section><section id="sandbox-section"'),('<button id="refresh">تحديث</button>','<button id="refresh">تحديث</button><button id="topup-more" hidden>تحميل طلبات أقدم</button>'),('الدفع المباشر والبطاقة البنكية غير مفعّلين حتى استكمال التكامل والتعاقد.','إعدادات الدفع المباشر مستقلة في قسم بوابة زين كاش أدناه.')]:
   if after in text:continue
   assert text.count(before)==1,'HOSTING_ANCHOR '+before;text=text.replace(before,after,1)
  text,n=re.subn(r'(<script src="\.\./finance\.js)(?:\?[^"<>]*)?("></script>)',r'\1?v=260\2',text);assert n==1
  if '../zaincash-gateway.js?'not in text:text=text.replace('<script src="../finance.js?v=260"></script>','<script src="../finance.js?v=260"></script><script src="../zaincash-gateway.js?v=260d"></script>',1)
  text=re.sub(r'(zaincash-gateway\.js)(?:\?[^"<>]*)?(?=")',r'\1?v=260d',text)
  text,n=re.subn(r'(finance-workspace\.js)(?:\?[^"<>]*)?(?=")',r'\1?v=260',text);assert n==1
  return text.encode()
 # Group contextual edits, never replace unreviewed portions of a newer live file.
 groups=list(difflib.SequenceMatcher(None,old,new,autojunk=False).get_grouped_opcodes(3))
 for group in groups:
  i1,i2=group[0][1],group[-1][2];j1,j2=group[0][3],group[-1][4];before=''.join(old[i1:i2]);after=''.join(new[j1:j2]);
  if text.count(before)==0 and text.count(after)==1:continue
  assert text.count(before)==1,'HOSTING_OVERLAP '+name;text=text.replace(before,after,1)
 return text.encode()
with zipfile.ZipFile(P/'hosting-base.zip')as old:
 overlay={n:apply_tracked_diff(n,old.read(n))for n in ['finance.js','finance-workspace.js','pages/finance.html']}
 overlay.update({n:(R/'frontend'/n).read_bytes()for n in ['zaincash-gateway.js','pages/zaincash-return.html']})
 with zipfile.ZipFile(P/'hosting-candidate.zip','w',zipfile.ZIP_DEFLATED)as new:
  for item in old.infolist():new.writestr(copy.copy(item),overlay.get(item.filename,old.read(item.filename)))
  for n,data in overlay.items():
   if n not in old.namelist():new.writestr(n,data)
 with zipfile.ZipFile(P/'hosting-candidate.zip')as new:assert all(old.read(n)==new.read(n)for n in old.namelist()if n not in overlay)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==job['jobId'],'HOSTING_DRIFT'
up=a.create_deployment(**args);record['hosting']={'baseJobId':job['jobId'],'jobId':up['jobId'],'changedFiles':list(overlay),'status':'UPLOADING','unrelatedFilesPreserved':True};save()
urllib.request.urlopen(urllib.request.Request(up['zipUploadUrl'],data=(P/'hosting-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=90).close();a.start_deployment(**args,jobId=up['jobId'])
print('HOSTING_STARTED',up['jobId'],flush=True)
for _ in range(60):
 status=a.get_job(**args,jobId=up['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
assert status=='SUCCEED',status
for n,data in overlay.items():
 for _ in range(12):
  if urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?verify=260',timeout=20).read()==data:break
  time.sleep(2)
 else:raise AssertionError('HOSTED_BYTES '+n)

for n in ['finance.js','finance-workspace.js','pages/finance.html']:(R/'frontend'/n).write_bytes(overlay[n])
record['hosting']['status']='SUCCEED_VERIFIED';record['status']='STAGING_PUBLISHED_VERIFIED_LIVE_ACCEPTANCE_PENDING';save();print('PUBLISHED_VERIFIED',flush=True)
