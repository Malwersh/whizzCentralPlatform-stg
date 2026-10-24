"""Bounded staging publication. Never creates a case, refund, receipt or payment."""
import pathlib,sys,json,zipfile,copy,hashlib,base64,urllib.request,time
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/customer-cash-266');s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180'
l=s.client('lambda');a=s.client('amplify');cf=s.client('cloudformation');args={'appId':'d2vmebm1e1n95m','branchName':'staging'};sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
for name in ['wallet','staff','order','driver-backend','bundle','legacy','proxies','runtime','retention']:
 text=pathlib.Path('/private/tmp/customer-cash-266-'+name+'.log').read_text();assert 'ℹ fail 0'in text,name
for name in ['browser','preflight']:assert 'PASS'in pathlib.Path('/private/tmp/customer-cash-266-'+name+'.log').read_text(),name
for name in ['user','driver']:
 assert 'All tests passed!'in pathlib.Path('/private/tmp/customer-cash-266-'+name+'-flutter.log').read_text()
 assert '✓ Built'in pathlib.Path('/private/tmp/customer-cash-266-'+name+'-ios.log').read_text()
assert all(x['decision']=='allowed'for x in json.loads((p/'access.json').read_text()))
packages=json.loads((p/'packages.json').read_text());assert {f['label']for f in packages}=={'deletion','expiry','financial','staff','order','driver','monitor'};record={'part':266,'status':'PRECHECK','scope':'staging','functions':[],'iamChanged':False,'configurationChanged':False,'realCaseOrFinancialMutationByAgent':False,'historicalCasesMigrated':False,'nativeSimulatorBuilds':{'customerDebug':215,'driverDebug':216},'financialAdjustmentsForShortfall':'SEPARATE_EXECUTION_PENDING','electronicRefundSource':'NOT_ENABLED'};doc=r/'docs/customer-cash-publication-266.json'
def save():doc.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
for f in packages:
 raw=(p/(f['label']+'-candidate.zip')).read_bytes();assert hashlib.sha256(raw).hexdigest()==f['packageSha256'];cfg=l.get_function_configuration(FunctionName=f['function']);assert cfg['CodeSha256']==f['baseCodeSha256'],f['function']
# Check the CloudFormation-owned monitor before ANY function mutation.
stack='staging-order-exception-cases-access-232';raw=cf.get_template(StackName=stack,TemplateStage='Original')['TemplateBody'];template=json.loads(raw)if isinstance(raw,str)else raw;monitor_template=copy.deepcopy(template)
# The live 265 monitor contains one reviewed SLA snapshot correction absent from the stack template.
with zipfile.ZipFile(p/'monitor-base.zip')as z:live_monitor=z.read('index.js').decode().strip()
stack_monitor=template['Resources']['Monitor']['Properties']['Code']['ZipFile'].strip()
previous_line='const expected = casePhase(row.casePolicySnapshot, phase.priority, phase.startedAt);'
corrected_line='const expected = casePhase(phase.priority === "FINANCIAL" && phase.startedAt === row.guaranteeResolution?.retainedAt && row.guaranteeResolution?.state === "RETAINED" ? row.guaranteeResolution.slaPolicySnapshot : phase.priority === "CUSTODY" && phase.startedAt === row.handoverIssue?.reportedAt ? row.handoverIssue.slaPolicySnapshot : row.casePolicySnapshot, phase.priority, phase.startedAt);'
assert stack_monitor.count(previous_line)==1
assert stack_monitor.replace(previous_line,corrected_line,1)==live_monitor
record['reviewedExistingMonitorDrift']='Preserved live financial/custody SLA snapshot correction; code-only stack update reconciles template.' 
with zipfile.ZipFile(p/'monitor-candidate.zip')as z:monitor_template['Resources']['Monitor']['Properties']['Code']['ZipFile']=z.read('index.js').decode()
check=copy.deepcopy(monitor_template);check['Resources']['Monitor']['Properties']['Code']=template['Resources']['Monitor']['Properties']['Code'];assert check==template
cf.validate_template(TemplateBody=json.dumps(monitor_template));(p/'monitor-template.json').write_text(json.dumps(monitor_template,indent=2))
base=a.list_jobs(**args,maxResults=1)['jobSummaries'][0];assert base['status']=='SUCCEED';job=a.get_job(**args,jobId=base['jobId'])['job'];url=next(x['artifactsUrl']for x in job['steps']if x.get('artifactsUrl'));(p/'hosting-base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read())
changes={n:(r/'frontend'/n).read_bytes()for n in ['order-exception-cases.js','pages/order-exceptions.html','customer-cash-review.js','pages/customer-cash-review.html']}
with zipfile.ZipFile(p/'hosting-base.zip')as old:
 local=changes['order-exception-cases.js'].decode();original=local.replace("CUSTOMER_CASH_REVIEW:'مراجعة نقد ورد مبلغ',CLOSED:'أُغلقت المراجعة',",'',1).replace("if(item.type==='CUSTOMER_CASH_REVIEW'){location.href='customer-cash-review.html?'+new URLSearchParams({orderId:item.orderId});return;}",'',1);assert original.encode()==old.read('order-exception-cases.js')
 assert changes['pages/order-exceptions.html'].replace(b'order-exception-cases.js?v=266',b'order-exception-cases.js?v=265')==old.read('pages/order-exceptions.html')
 with zipfile.ZipFile(p/'hosting-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for e in old.infolist():out.writestr(copy.copy(e),changes.get(e.filename,old.read(e.filename)))
  for n,b in changes.items():
   if n not in old.namelist():out.writestr(n,b)
 with zipfile.ZipFile(p/'hosting-candidate.zip')as out:assert all(old.read(n)==out.read(n)for n in old.namelist()if n not in changes)
record['status']='PUBLISHING';save()
for label in ['deletion','expiry','financial','staff','order','driver']:
 f=next(x for x in packages if x['label']==label);raw=(p/(label+'-candidate.zip')).read_bytes();before=json.loads((p/(label+'-config.private.json')).read_text());cfg=l.get_function_configuration(FunctionName=f['function']);assert cfg['CodeSha256']==f['baseCodeSha256']
 l.update_function_code(FunctionName=f['function'],RevisionId=cfg['RevisionId'],ZipFile=raw,Publish=False)
 for _ in range(90):
  after=l.get_function_configuration(FunctionName=f['function'])
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha(raw)
 for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Layers','VpcConfig','Architectures']:assert before.get(k)==after.get(k),(label,k)
 record['functions'].append({**f,'deployedCodeSha256':after['CodeSha256'],'configurationPreserved':True});save();print('Verified '+f['function'],flush=True)
 if label=='financial':
  record['negativeSmoke']=[]
  for action in ['customer_cash_case','driver_cash_case','staff_cash_case']:
   response=l.invoke(FunctionName=f['function'],Payload=json.dumps({'action':action,'accessToken':'invalid-smoke-token','body':{'action':'READ_CUSTOMER_CASH_CASE','orderId':'smoke-order'}}).encode());data=json.loads(response['Payload'].read());assert not response.get('FunctionError')and data['statusCode']==401,data
   record['negativeSmoke'].append({'action':action,'statusCode':401,'code':data['code']});save()
f=next(x for x in packages if x['label']=='monitor');cfg=l.get_function_configuration(FunctionName=f['function']);assert cfg['CodeSha256']==f['baseCodeSha256'];cf.update_stack(StackName=stack,TemplateBody=json.dumps(monitor_template),Capabilities=['CAPABILITY_NAMED_IAM'])
for _ in range(180):
 status=cf.describe_stacks(StackName=stack)['Stacks'][0]['StackStatus']
 if status not in ['UPDATE_IN_PROGRESS','UPDATE_COMPLETE_CLEANUP_IN_PROGRESS']:break
 time.sleep(2)
assert status=='UPDATE_COMPLETE',status
after=l.get_function_configuration(FunctionName=f['function']);before=json.loads((p/'monitor-config.private.json').read_text())
for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Layers','VpcConfig','Architectures']:assert before.get(k)==after.get(k),('monitor',k)
with zipfile.ZipFile(p/'monitor-candidate.zip')as z:expected=z.read('index.js')
live=l.get_function(FunctionName=f['function']);actual=zipfile.ZipFile(__import__('io').BytesIO(urllib.request.urlopen(live['Code']['Location'],timeout=60).read()));assert actual.read('index.js')==expected
record['functions'].append({**f,'deployedCodeSha256':after['CodeSha256'],'configurationPreserved':True,'cloudFormationCodeOnly':True});save();print('Verified code-only monitor stack update',flush=True)
assert a.list_jobs(**args,maxResults=1)['jobSummaries'][0]['jobId']==base['jobId'];up=a.create_deployment(**args);record['hosting']={'baseJobId':base['jobId'],'jobId':up['jobId'],'status':'UPLOADING','changedFiles':list(changes),'unrelatedFilesPreserved':True};save()
urllib.request.urlopen(urllib.request.Request(up['zipUploadUrl'],data=(p/'hosting-candidate.zip').read_bytes(),method='PUT',headers={'Content-Type':'application/zip'}),timeout=120).read();a.start_deployment(**args,jobId=up['jobId']);print('Hosting '+up['jobId'],flush=True)
for _ in range(100):
 status=a.get_job(**args,jobId=up['jobId'])['job']['summary']['status']
 if status in ['SUCCEED','FAILED','CANCELLED']:break
 time.sleep(2)
record['hosting']['status']=status;save();assert status=='SUCCEED'
for n,b in changes.items():
 for attempt in range(12):
  actual=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?verify=266-'+str(attempt),timeout=30).read()
  if actual==b:break
  time.sleep(2)
 assert actual==b,n
record['hosting']['hostedBytesVerified']=True;record['status']='PUBLISHED';save();print('PASS staging customer cash review publication; no real report, approval, refund, customer acknowledgment or financial correction by agent.',flush=True)
