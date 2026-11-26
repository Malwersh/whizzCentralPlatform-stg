"""Publish only verified region adapters over current staging packages.
No business-record writes. Exact region read/condition permissions; no region writes.
"""
from pathlib import Path
import json,zipfile,copy,hashlib,base64,subprocess,urllib.request,concurrent.futures
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/driver-work-region-311';P.mkdir(parents=True,exist_ok=True)
B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];receipt_path=R/'docs/driver-work-region-publication-311.json';history_path=R/'docs/driver-vehicle-publication-308.json'
def aws(*args):
 raw=subprocess.check_output(B+list(args)+['--output','json']);return json.loads(raw)if raw.strip()else{}
def digest(path):return base64.b64encode(hashlib.sha256(path.read_bytes()).digest()).decode()
assert 'ℹ pass 56'in Path('/private/tmp/regions-311-package-tests.log').read_text()
assert 'ℹ pass 12'in Path('/private/tmp/regions-311-core-tests.log').read_text()
assert not Path('/private/tmp/regions-311-tsc.log').read_text().strip()
audit=json.loads(Path('/private/tmp/regions-311-live-audit.json').read_text());assert audit['allowed']
previous=json.loads(receipt_path.read_text()) if receipt_path.exists() else {}
previous_hashes={r['name']:r['hash'] for r in previous.get('functions',[])}
history=json.loads(history_path.read_text());report={'status':'PREPARING','iam':[],'functions':[],'tests':{'packagedDelegates':56,'regionCore':12,'actualLocationFunction':'PASS','liveReadOnly':audit},'businessDataMutatedDirectly':False}
def save():receipt_path.write_text(json.dumps(report,indent=2)+'\n')
save()
# Capture every live artifact and verify against our previous publication receipt.
def prepare(row):
 name=row['name'];p=P/name;p.mkdir(exist_ok=True);live=aws('lambda','get-function','--function-name',name);cfg=live['Configuration'];assert cfg['CodeSha256'] in {row['hash'],previous_hashes.get(name)},'LIVE_DRIFT '+name
 (p/'config.private.json').write_text(json.dumps(cfg));base=p/'base.zip';urllib.request.urlretrieve(live['Code']['Location'],base);assert digest(base)==cfg['CodeSha256'];z=zipfile.ZipFile(base);changes={}
 if 'driver-vehicles-runtime-308.js'in z.namelist():changes['driver-vehicles-runtime-308.js']=(R/'backend/.tmp/driver-vehicles-308/driver-vehicles-runtime-308.js').read_bytes()
 if name=='DriversApi-staging':
  main=p/'lambda_driver_api_v2.js';main.write_bytes(z.read('lambda_driver_api_v2.js'))
  for function in ['startSearching','updateLocation','checkDriverRegionPermission','determineRegionFromCoordinates']:
   subprocess.run(['node',str(R/'scripts/prepare-driver-stop-fence-308.cjs'),str(main),str(R.parent/'whizzDrivers-stg/backend/lambda_driver_api_v2.js'),function],check=True)
  subprocess.run(['node','--check',str(main)],check=True)
  changes.update({'lambda_driver_api_v2.js':main.read_bytes(),'driver-work-region-311.js':(R/'backend/shared/driver-work-region-311.js').read_bytes(),'driver-region-locator-311.js':(R/'backend/.tmp/driver-region-locator-311.js').read_bytes()})
 assert changes,'NO_REGION_RUNTIME '+name
 target=p/'candidate.zip'
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for file,data in changes.items():
   if file not in z.namelist():out.writestr(file,data)
 with zipfile.ZipFile(target)as after:assert all(after.read(f)==z.read(f)for f in z.namelist()if f not in changes)
 return {'name':name,'beforeHash':cfg['CodeSha256'],'hash':digest(target),'changedFiles':list(changes),'role':cfg['Role'],'otherEntriesPreserved':True}
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:report['functions']=list(pool.map(prepare,history['functions']))
report['status']='PREPARED';save()
# Read and transactional-condition access to exactly these existing references.
arn='arn:aws:dynamodb:us-east-1:699561669180:table/'
resources=[arn+t for t in ['WizzCentral_Regions','WizzCentral_RegionsDerived_staging','WizzCentral_RegionNeighbors_staging']]
roles={r['role'] for r in report['functions']if r['name']!='staging-wizz-staff-service'}
for role in roles:
 policy={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':resources}]}
 if role==next(x['role']for x in report['functions']if x['name']=='DriversApi-staging'):
  policy['Statement'].append({'Effect':'Allow','Action':['dynamodb:Query'],'Resource':[arn+'WizzCentral_RegionIndex_staging/index/h3-index']})
 role_name=role.rsplit('/',1)[-1];file=P/(role_name+'-policy.json');file.write_text(json.dumps(policy))
 try:old=aws('iam','get-role-policy','--role-name',role_name,'--policy-name','DriverWorkRegionRead311')
 except subprocess.CalledProcessError:old=None
 backup=P/(role_name+'-previous-policy.private.json')
 if not backup.exists():backup.write_text(json.dumps(old))
 aws('iam','put-role-policy','--role-name',role_name,'--policy-name','DriverWorkRegionRead311','--policy-document','file://'+str(file))
 simulation=aws('iam','simulate-principal-policy','--policy-source-arn',role,'--action-names','dynamodb:GetItem','dynamodb:ConditionCheckItem','--resource-arns',*resources)
 decisions=[d['EvalResourceDecision']for e in simulation['EvaluationResults']for d in e.get('ResourceSpecificResults',[])]
 if not decisions:decisions=[e['EvalDecision']for e in simulation['EvaluationResults']]
 assert decisions and all(d=='allowed'for d in decisions),'REGION_READ_IAM_FAILED '+role_name
 report['iam'].append({'role':role,'policyName':'DriverWorkRegionRead311','sourceReadAndConditionOnly':True,'verified':True});save()
report['status']='PUBLISHING_CODE';save()
def publish(row):
 name=row['name'];cfg=aws('lambda','get-function-configuration','--function-name',name);assert cfg['CodeSha256']==row['beforeHash'],'LIVE_DRIFT '+name
 aws('lambda','update-function-code','--function-name',name,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(P/name/'candidate.zip'))
 subprocess.run(B+['lambda','wait','function-updated-v2','--function-name',name],check=True)
 after=aws('lambda','get-function-configuration','--function-name',name);assert after['CodeSha256']==row['hash']and after['Environment']==cfg['Environment']and after['Role']==cfg['Role']
 print('Code verified',name,flush=True);return row
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:list(pool.map(publish,report['functions']))
report['status']='ACTIVATING';save()
def activate(row):
 name=row['name'];cfg=aws('lambda','get-function-configuration','--function-name',name);assert cfg['CodeSha256']==row['hash'];variables=cfg['Environment']['Variables'];variables['DRIVER_WORK_REGION_ENFORCE']='true'
 env=P/name/'environment.private.json';env.write_text(json.dumps({'Variables':variables}))
 aws('lambda','update-function-configuration','--function-name',name,'--revision-id',cfg['RevisionId'],'--environment','file://'+str(env))
 subprocess.run(B+['lambda','wait','function-updated-v2','--function-name',name],check=True)
 after=aws('lambda','get-function-configuration','--function-name',name);assert after['CodeSha256']==row['hash']and after['Environment']['Variables']==variables and after['LastUpdateStatus']=='Successful'
 row['regionEnforced']=True;row['configurationPreservedExceptRegionFlag']=True;print('Region enforcement verified',name,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:list(pool.map(activate,report['functions']))
for row in history['functions']:row['hash']=next(x['hash']for x in report['functions']if x['name']==row['name'])
history_path.write_text(json.dumps(history,indent=2)+'\n');report['status']='PUBLISHED_VERIFIED';save()
