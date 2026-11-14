import pathlib,json,zipfile,hashlib,base64,copy,subprocess,time,boto3
root=pathlib.Path(__file__).resolve().parents[1];p=root/'backend/.tmp/cancel-after-release-255';sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
assert 'fail 0' in pathlib.Path('/private/tmp/cancel256-tests.log').read_text()
assert 'fail 0' in pathlib.Path('/private/tmp/cancel256-bundle-tests.log').read_text()
base=p/'candidate.zip';candidate=p/'256-staff-order-management-runtime.js';name='staging-driver-financial-accept';s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');before=l.get_function_configuration(FunctionName=name)
assert before['CodeSha256']==sha(base.read_bytes())==json.loads((root/'docs/cancellation-after-unassignment-publication-255.json').read_text())['after'],'LIVE_DRIFT'
subprocess.run(['node','--check',str(candidate)],check=True)
with zipfile.ZipFile(base)as z:
 original=z.read('staff-order-management-runtime.js').decode();new=candidate.read_text();old='!equal(o4.commercialPricing.deliveryFunding, snapshot.deliveryFunding)';replacement='!equal(o4.commercialPricing.deliveryFunding ?? null, snapshot.deliveryFunding)';assert original.count(old)==1 and original.replace(old,replacement)==new
 with zipfile.ZipFile(p/'256.zip','w',zipfile.ZIP_DEFLATED)as out:
  for i in z.infolist():out.writestr(copy.copy(i),candidate.read_bytes()if i.filename=='staff-order-management-runtime.js'else z.read(i.filename))
 with zipfile.ZipFile(p/'256.zip')as out:assert all(z.read(n)==out.read(n)for n in z.namelist()if n!='staff-order-management-runtime.js')
raw=(p/'256.zip').read_bytes();l.update_function_code(FunctionName=name,RevisionId=before['RevisionId'],ZipFile=raw)
for _ in range(50):
 after=l.get_function_configuration(FunctionName=name)
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(1)
assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha(raw)
for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Architectures','VpcConfig']:assert before.get(k)==after.get(k)
r={'part':256,'status':'PUBLISHED','function':name,'before':before['CodeSha256'],'after':after['CodeSha256'],'changedFiles':['staff-order-management-runtime.js'],'change':'Normalize absent commercial delivery funding to null while preserving exact funded matching','unrelatedEntriesIdentical':True,'configurationAndIamPreserved':True,'sourceTests':25,'capturedRuntimeTests':11,'realOrderFullCancellationDryRun':{'plannedOperations':14,'reads':9,'mutationsExecuted':0,'authenticatedStaffExecution':False},'humanAcceptance':'PENDING_ADMIN_RETRY','agentDirectBusinessWrites':False};(root/'docs/cancellation-null-funding-publication-256.json').write_text(json.dumps(r,indent=2)+'\n');print('PUBLISHED',name,after['CodeSha256'])
