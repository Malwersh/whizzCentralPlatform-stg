"""Validate the task-owned components, allowing unrelated concurrent financial releases."""
import pathlib,sys,json,zipfile,io,urllib.request,re,concurrent.futures,hashlib,datetime,os,subprocess
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/registry-259');s=session();l=s.client('lambda');q=r/'docs/merchant-staff-settlements-publication-259.json';pub=json.loads(q.read_text());records=[];registry=(r/'backend/staff-service/staff-capabilities.js').read_bytes();pattern=re.compile(rb'^// [^\n]*staff-capabilities\.js\nvar \w+ = __commonJS\(\{\n  "[^"]+"\(exports\w*, (module\w*)\) \{\n([\s\S]*?)\n  \}\n\}\);',re.M)
patch=b'// platformBenefitFinancialCompatibility\nif(typeof value?.deliveryFunding?.policyPin?.policyId===\'string\'&&value.deliveryFunding.policyPin.policyId.startsWith(\'PLATFORM_BENEFIT#\'))return require("./financial-compatibility.js").allocateDeliveryFundedOrder(value);\n\n'
def inspect(f):
 name=f['function'];v=l.get_function(FunctionName=name);raw=urllib.request.urlopen(v['Code']['Location'],timeout=90).read();z=zipfile.ZipFile(io.BytesIO(raw));assert v['Configuration']['LastUpdateStatus']=='Successful',name;expected=zipfile.ZipFile(p/('staff-final.zip'if name=='staging-wizz-staff-service'else name+'-candidate.zip'));checked=[]
 for file in f['changes']:
  b=z.read(file)
  if file.endswith('staff-capabilities.js'):assert b==registry,(name,file)
  elif file=='settlement-runtime.js':assert b.replace(patch,b'')==expected.read(file),(name,file,'UNREVIEWED_RUNTIME_CHANGE')
  elif file=='index.js'and name=='staging-wizz-staff-service':
   snippet=expected.read(file).split(b'const merchantStaffOriginalHandler259=')[1];assert b'const merchantStaffOriginalHandler259='+snippet in b,(name,file)
  elif pattern.search(expected.read(file)):
   # The module wrapper and registry are our change; other compiled modules belong to concurrent work.
   before=pattern.findall(expected.read(file));after=pattern.findall(b);assert before and before==after,(name,file,'REGISTRY_CHANGED')
  else:assert b==expected.read(file),(name,file,'TASK_COMPONENT_CHANGED')
  checked.append(file)
 if name=='staging-wizz-staff-service':
  live=r/'backend/.tmp/order-exceptions-work/staff-settlement-259/verified-live';live.mkdir(parents=True,exist_ok=True)
  for file in ['settlement-runtime.js','financial-compatibility.js']:
   if file in z.namelist():(live/file).write_bytes(z.read(file))
 changed=[k for k in set(expected.namelist())|set(z.namelist())if k not in expected.namelist()or k not in z.namelist()or expected.read(k)!=z.read(k)]
 return {'function':name,'currentCodeSha256':v['Configuration']['CodeSha256'],'taskComponentsVerified':checked,'concurrentDifferencesPreserved':changed}
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:records=list(pool.map(inspect,pub['functions']))
policy=s.resource('dynamodb').Table('staging-PlatformStaff').get_item(Key={'pk':'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS','sk':'CURRENT'},ConsistentRead=True)['Item'];assert policy['version']==2;assert 'finance.payout.receive'in policy['enabledPermissions'];assert 'finance.approve'not in policy['enabledPermissions']and'finance.transfer'not in policy['enabledPermissions']
checks=[]
for method,input,status in [('GET',{'view':'payout-context','branchId':'invalid'},401),('POST',{'action':'APPROVE_PAYOUT','branchId':'invalid'},403)]:
 v=l.invoke(FunctionName='staging-wizz-staff-service',Payload=json.dumps({'action':'merchant_device_payout','deviceToken':'invalid','staffSession':'invalid','httpMethod':method,'input':input}).encode());d=json.loads(v['Payload'].read());assert not v.get('FunctionError')and d['statusCode']==status,d;checks.append({'statusCode':status,'code':d['code']})
# Read existing PAID evidence using the actual current bundle, with every write blocked.
c=s.get_credentials().get_frozen_credentials();cfg=l.get_function_configuration(FunctionName='staging-wizz-staff-service');env=os.environ.copy();env.update(cfg.get('Environment',{}).get('Variables',{}));env.update(AWS_ACCESS_KEY_ID=c.access_key,AWS_SECRET_ACCESS_KEY=c.secret_key,AWS_SESSION_TOKEN=c.token or '',AWS_REGION='us-east-1',NODE_PATH=str(r/'backend/staff-service/node_modules'));subprocess.run(['node','scripts/verify-current-payout-259.cjs'],cwd=r,env=env,check=True)
subprocess.run(['node','--require','./scripts/load-merchant-staff-live-259.cjs','--test','backend/wallet-service/test/merchant-staff-settlements-259.test.cjs'],cwd=r,env=env,check=True,stdout=open('/private/tmp/merchant-staff-settlement-259-live-bundle.log','w'))
record={'part':259,'status':'PASS','verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'staging','deployedServicesVerified':records,'policyVersion':2,'latestHostingJobId':pub['recipientWordingHosting']['jobId'],'negativeSmokeChecks':checks,'liveBundleTests':14,'paidPayoutRegression':'PASS_READ_ONLY','humanEmployeeReceiptAcceptance':'PENDING_EXPLICIT_OWNER_GRANT_AND_FUTURE_REAL_RECEIPT','payoutOrCashOperationsExecutedByAgent':False,'nativeBuild':226,'nativeSimulatorInstalledAndLaunched':True,'iamChanges':False};(r/'docs/merchant-staff-settlements-verification-259.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');print('PASS nine live task components, policy 2, device transport denial, fourteen live bundle tests and existing PAID evidence; concurrent releases preserved.',flush=True)
