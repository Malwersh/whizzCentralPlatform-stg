"""Staging-only publication. Never creates a region, impersonates an employee,
or changes existing regional boundaries. Consumer migration precedes activation.
"""
from pathlib import Path
import subprocess,json,zipfile,urllib.request,copy,hashlib,base64,time,os
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/regions-312';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];doc=R/'docs/region-management-publication-312.json'
def aws(*args):
 raw=subprocess.check_output(B+list(args)+['--output','json']);return json.loads(raw)if raw.strip()else{}
def digest(p):return base64.b64encode(hashlib.sha256(p.read_bytes()).digest()).decode()
def wait(name):subprocess.run(B+['lambda','wait','function-updated-v2','--function-name',name],check=True)
def simulate(role,actions,resources,leading=None):
 args=['iam','simulate-principal-policy','--policy-source-arn',role,'--action-names',*actions,'--resource-arns',*resources]
 if leading:args+=['--context-entries','ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues='+leading+',ContextKeyType=stringList']
 result=aws(*args);decisions=[r['EvalResourceDecision']for e in result['EvaluationResults']for r in e.get('ResourceSpecificResults',[])]or[e['EvalDecision']for e in result['EvaluationResults']]
 assert decisions and all(d=='allowed'for d in decisions),'IAM_NOT_ALLOWED '+str(actions);return True
manifest=json.loads((R/'docs/region-management-validation-312.json').read_text());assert manifest['status']=='PASS'
for row in manifest['sourceFiles']:assert hashlib.sha256((R/row['file']).read_bytes()).hexdigest()==row['sha256'],'SOURCE_CHANGED '+row['file']
for name,h in manifest['artifactHashes'].items():assert hashlib.sha256((P/name).read_bytes()).hexdigest()==h,'ARTIFACT_CHANGED '+name
report=json.loads(doc.read_text());assert report['status'] in ['INFRASTRUCTURE_READY_DISABLED','PUBLISHING_BACKEND'] and not report.get('functions');report['status']='PUBLISHING_BACKEND';report['validationManifest']='docs/region-management-validation-312.json';report['tests']['service']=manifest['serviceTests'];doc.write_text(json.dumps(report,indent=2)+'\n')
queue=report['infrastructure'];arn='arn:aws:dynamodb:us-east-1:699561669180:table/';staffName='staging-wizz-staff-service';readerName='WizzUser-FindRegionByCoordinates-staging'
staff=aws('lambda','get-function','--function-name',staffName);reader=aws('lambda','get-function','--function-name',readerName)
expected=next(x['hash']for x in json.loads((R/'docs/driver-work-region-publication-311.json').read_text())['functions']if x['name']==staffName);assert staff['Configuration']['CodeSha256']==expected,'STAFF_LIVE_DRIFT'
readerAudit=json.loads((P/'readers/audit.json').read_text());expectedReader=next(x['hash']for x in readerAudit if x['name']==readerName);assert reader['Configuration']['CodeSha256']==expectedReader,'READER_LIVE_DRIFT'
for tag,data in [('staff',staff),('reader',reader)]:
 (P/(tag+'-before-config.private.json')).write_text(json.dumps(data['Configuration']));urllib.request.urlretrieve(data['Code']['Location'],P/(tag+'-base-current.zip'));assert digest(P/(tag+'-base-current.zip'))==data['Configuration']['CodeSha256']
# Preserve all unrelated archive entries exactly, including prior finance/driver routes.
z=zipfile.ZipFile(P/'staff-base-current.zip');inner=P/'staff-final-inner.js';inner.write_bytes(z.read('_discount_review/central-staff/index.js'));subprocess.run(['node',str(R/'scripts/patch-region-staff-route-312.cjs'),str(inner)],check=True);subprocess.run(['node','--check',str(inner)],check=True)
staffChanges={'_discount_review/central-staff/index.js':inner.read_bytes(),'region-management-api-312.js':(P/'region-management-api-312.js').read_bytes()}
readerChanges={'lambdas/find-region-by-coordinates.js':(R/'../wizzuser-stg/backend/src/lambdas/find-region-by-coordinates.js').read_bytes(),'utils/region-coverage-runtime-312.js':(P/'region-coverage-runtime-312.js').read_bytes(),'utils/business-metadata-utils.js':(R/'../wizzuser-stg/backend/src/utils/business-metadata-utils.js').read_bytes(),'lambdas/auto-populate-business-metadata.js':(R/'../wizzuser-stg/backend/src/lambdas/auto-populate-business-metadata.js').read_bytes()}
def overlay(tag,changes):
 z=zipfile.ZipFile(P/(tag+'-base-current.zip'));out=P/(tag+'-candidate.zip')
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED)as target:
  for info in z.infolist():target.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for name,data in changes.items():
   if name not in z.namelist():target.writestr(name,data)
 with zipfile.ZipFile(out)as after:assert all(after.read(f)==z.read(f)for f in z.namelist()if f not in changes)
 return out
staffZip=overlay('staff',staffChanges);readerZip=overlay('reader',readerChanges)
# Attach narrow additive permissions; preserve every existing policy.
staffPolicy={'Version':'2012-10-17','Statement':[
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:Scan'],'Resource':[arn+'WizzCentral_Regions',arn+'WizzCentral_RegionsDerived_staging']},
 {'Effect':'Allow','Action':['dynamodb:Query'],'Resource':[arn+'WizzCentral_RegionAudit_staging/index/region-index']},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:Query','dynamodb:PutItem','dynamodb:DeleteItem','dynamodb:ConditionCheckItem'],'Resource':[arn+'staging-PlatformStaff'],'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['REGION_JOB#*','REGIONS_*']}}},
 {'Effect':'Allow','Action':['dynamodb:PutItem'],'Resource':[arn+'staging-PlatformStaff'],'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['AUDIT']}}},
 {'Effect':'Allow','Action':['sqs:SendMessage'],'Resource':[queue['QueueArn']]}]}
readerPolicy={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['dynamodb:GetItem'],'Resource':[arn+'WizzCentral_Regions',arn+'WizzCentral_RegionsDerived_staging']},{'Effect':'Allow','Action':['dynamodb:Query'],'Resource':[arn+'WizzCentral_RegionIndex_staging/index/h3-index']}]}
for tag,config,policy,name in [('staff',staff['Configuration'],staffPolicy,'RegionManagement312'),('reader',reader['Configuration'],readerPolicy,'RegionCompositeRead312')]:
 file=P/(tag+'-policy.json');file.write_text(json.dumps(policy));role=config['Role'].rsplit('/',1)[-1]
 if tag=='staff':
  policyName='staging-region-management-api-312-'+hashlib.sha256(json.dumps(policy,sort_keys=True).encode()).hexdigest()[:8]
  policyArn='arn:aws:iam::699561669180:policy/'+policyName
  check=subprocess.run(B+['iam','get-policy','--policy-arn',policyArn,'--output','json'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  if check.returncode:
   aws('iam','create-policy','--policy-name',policyName,'--policy-document','file://'+str(file),'--description','Scoped region draft publication and queue access; no region base writes')
  else:
   info=json.loads(check.stdout);current=aws('iam','get-policy-version','--policy-arn',policyArn,'--version-id',info['Policy']['DefaultVersionId'])['PolicyVersion']['Document'];assert current==policy,'POLICY_DRIFT'
  aws('iam','attach-role-policy','--role-name',role,'--policy-arn',policyArn);report['staffManagedPolicyArn']=policyArn
 else:aws('iam','put-role-policy','--role-name',role,'--policy-name',name,'--policy-document','file://'+str(file))
simulate(staff['Configuration']['Role'],['dynamodb:GetItem','dynamodb:Scan'],[arn+'WizzCentral_Regions',arn+'WizzCentral_RegionsDerived_staging'])
simulate(staff['Configuration']['Role'],['dynamodb:GetItem','dynamodb:Query','dynamodb:PutItem','dynamodb:DeleteItem','dynamodb:ConditionCheckItem'],[arn+'staging-PlatformStaff'],'REGIONS_PLAN#validation')
simulate(staff['Configuration']['Role'],['sqs:SendMessage'],[queue['QueueArn']]);simulate(reader['Configuration']['Role'],['dynamodb:GetItem'],[arn+'WizzCentral_Regions',arn+'WizzCentral_RegionsDerived_staging']);simulate(reader['Configuration']['Role'],['dynamodb:Query'],[arn+'WizzCentral_RegionIndex_staging/index/h3-index'])
# Validate actual worker permissions used by queued phases, and absence of money access.
workerRole=queue['WorkerRoleArn'];simulate(workerRole,['dynamodb:GetItem','dynamodb:Scan','dynamodb:PutItem','dynamodb:DeleteItem','dynamodb:ConditionCheckItem'],[arn+'WizzCentral_Regions',arn+'WizzCentral_RegionsDerived_staging',arn+'WizzCentral_RegionNeighbors_staging'])
simulate(workerRole,['dynamodb:Query'],[arn+'WizzCentral_RegionIndex_staging/index/region-id-index']);simulate(workerRole,['dynamodb:Query','dynamodb:GetItem','dynamodb:PutItem','dynamodb:DeleteItem','dynamodb:ConditionCheckItem'],[arn+'staging-PlatformStaff'],'REGION_JOB#validation');simulate(workerRole,['dynamodb:GetItem','dynamodb:ConditionCheckItem'],[arn+'staging-PlatformStaff'],'EMPLOYEE#validation')
negative=aws('iam','simulate-principal-policy','--policy-source-arn',workerRole,'--action-names','dynamodb:PutItem','dynamodb:UpdateItem','--resource-arns',arn+'staging-Wallets',arn+'staging-LedgerEntries');assert all(r['EvalDecision']!='allowed'for r in negative['EvaluationResults']);report['workerHasNoFinancialAccess']=True
# Publish the reader first and preserve its exact API integration/other configuration.
report['functions']=[]
def publish(name,tag,target,changes):
 cfg=aws('lambda','get-function-configuration','--function-name',name);before=json.loads((P/(tag+'-before-config.private.json')).read_text());assert cfg['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT '+name
 aws('lambda','update-function-code','--function-name',name,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(target));wait(name);after=aws('lambda','get-function-configuration','--function-name',name);assert after['CodeSha256']==digest(target)and after['Environment']==before['Environment']and after['Role']==before['Role']
 row={'name':name,'beforeHash':before['CodeSha256'],'hash':digest(target),'changedFiles':list(changes),'otherEntriesPreserved':True,'rolePreserved':True};report['functions'].append(row);doc.write_text(json.dumps(report,indent=2)+'\n');print('Published verified code',name,flush=True)
def env(name,patch):
 cfg=aws('lambda','get-function-configuration','--function-name',name);variables={**cfg['Environment']['Variables'],**patch};assert len(json.dumps(variables).encode())<=4096,'ENVIRONMENT_CAPACITY';file=P/(name+'-environment.private.json');file.write_text(json.dumps({'Variables':variables}));aws('lambda','update-function-configuration','--function-name',name,'--revision-id',cfg['RevisionId'],'--environment','file://'+str(file));wait(name);after=aws('lambda','get-function-configuration','--function-name',name);assert after['CodeSha256']==cfg['CodeSha256']and after['Environment']['Variables']==variables
publish(readerName,'reader',readerZip,readerChanges);env(readerName,{'REGIONS_DERIVED_TABLE':'WizzCentral_RegionsDerived_staging','REGION_COMPOSITE_READERS_VERSION':'312'})
# Public read only: no token impersonation and no business mutation.
url='https://4jut6787c8.execute-api.us-east-1.amazonaws.com/staging/api/regions/find-by-coordinates?latitude=31.913292&longitude=44.476014';data=json.loads(urllib.request.urlopen(url,timeout=30).read());assert data.get('success')is True and data['data']['region_id']=='Rmhvcpnn3iy5f1','READER_LIVE_SMOKE_FAILED';report['readerReadOnlySmoke']={'success':True,'regionId':data['data']['region_id']}
publish(staffName,'staff',staffZip,staffChanges)
# Upload the final tested worker revision and activate its CFN bindings only now.
worker=P/'worker-final.zip'
with zipfile.ZipFile(worker,'w',zipfile.ZIP_DEFLATED)as out:
 info=zipfile.ZipInfo('index.js',(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;out.writestr(info,(P/'region-management-worker-312.js').read_bytes())
key='region-management/312/'+hashlib.sha256(worker.read_bytes()).hexdigest()+'/worker.zip';aws('s3api','put-object','--bucket',report['artifactBucket'],'--key',key,'--body',str(worker),'--server-side-encryption','AES256')
params=json.loads((P/'stack-parameters.private.json').read_text());params.update({'WorkerCodeKey':key,'Enabled':'true'});(P/'stack-parameters.private.json').write_text(json.dumps(params))
subprocess.run(B+['cloudformation','deploy','--template-file',str(R/'cloudformation/region-management-312.yaml'),'--stack-name','staging-region-management-312','--capabilities','CAPABILITY_NAMED_IAM','--no-fail-on-empty-changeset','--parameter-overrides',*[k+'='+v for k,v in params.items()]],check=True)
cfg=aws('lambda','get-function-configuration','--function-name','staging-region-publication-worker');assert cfg['CodeSha256']==digest(worker)and cfg['Environment']['Variables']['REGION_MANAGEMENT_ENABLED']=='true'and cfg['Environment']['Variables']['REGION_COMPOSITE_READERS_READY']=='true';report['workerCodeHash']=digest(worker);report['workerCodeKey']=key
mapping=aws('lambda','list-event-source-mappings','--function-name','staging-region-publication-worker')['EventSourceMappings'];assert len(mapping)==1 and mapping[0]['State']=='Enabled'and mapping[0]['FunctionResponseTypes']==['ReportBatchItemFailures'];assert aws('events','describe-rule','--name','staging-region-publication-recovery')['State']=='ENABLED'
env(staffName,{'REGION_MANAGEMENT_ENABLED':'true','REGION_COMPOSITE_READERS_READY':'true','REGION_PUBLICATION_QUEUE_URL':queue['QueueUrl']})
# Authentication remains mandatory for the management API.
try:urllib.request.urlopen('https://7oum9md7v6.execute-api.us-east-1.amazonaws.com/staging/staff/regions/manage',timeout=30);raise AssertionError('UNAUTHENTICATED_MANAGEMENT_ALLOWED')
except urllib.error.HTTPError as error:assert error.code==401
report['status']='BACKEND_PUBLISHED_VERIFIED';report['businessRegionDataMutated']=False;report['authentication401']=True;report['consumerEnabled']=True;report['recoveryEnabled']=True;doc.write_text(json.dumps(report,indent=2)+'\n')
# Keep the shared latest staff hash receipt consistent for later safe overlays.
old=R/'docs/driver-vehicle-publication-308.json';value=json.loads(old.read_text());next(x for x in value['functions']if x['name']==staffName)['hash']=digest(staffZip);old.write_text(json.dumps(value,indent=2)+'\n')
old=R/'docs/driver-work-region-publication-311.json';value=json.loads(old.read_text());next(x for x in value['functions']if x['name']==staffName)['hash']=digest(staffZip);old.write_text(json.dumps(value,indent=2)+'\n')
print('Region management backend, reader compatibility and durable recovery verified; existing region data untouched',flush=True)
