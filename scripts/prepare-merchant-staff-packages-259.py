import pathlib,json,zipfile,copy,subprocess,hashlib,difflib
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/registry-259');m=r.parent/'whizzMerchants-stg';source=(m/'backend/merchant-platform/staff-capabilities.js').read_bytes();rows=[]
for entry in json.loads((p/'inventory.json').read_text()):
 if not entry['registryFiles']:continue
 n=entry['function'];changes={}
 with zipfile.ZipFile(p/(n+'.zip'))as old:
  for name in entry['registryFiles']:
   if name.endswith('staff-capabilities.js'):changes[name]=source
   else:
    a=p/'bundle-input.js';b=p/'bundle-output.js';a.write_bytes(old.read(name));subprocess.run(['node','scripts/patch-staff-registry-bundle-259.cjs',str(a),str(b)],cwd=r,check=True,capture_output=True);changes[name]=b.read_bytes()
  if n=='staging-wizz-staff-service':
   for name in ['settlement-runtime.js','merchant-device-payouts.js']:changes[name]=(r/'backend/staff-service'/name).read_bytes()
   index=old.read('index.js').decode();assert 'merchant_device_payout' not in index
   shim="""
const merchantStaffOriginalHandler259=module.exports.handler;
module.exports.handler=async function(event,...args){
 if(event?.action==='merchant_device_payout'){
  const {DynamoDBClient}=require('@aws-sdk/client-dynamodb'),{DynamoDBDocumentClient}=require('@aws-sdk/lib-dynamodb');
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:process.env.AWS_REGION||'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}});
  return require('./merchant-device-payouts').handle({db,enabled:process.env.SETTLEMENT_SCHEDULE_ADMIN_ENABLED==='true'},event);
 }
 return merchantStaffOriginalHandler259(event,...args);
};
"""
   changes['index.js']=(index+shim).encode()
  if 'unified-auth' in n:
   for name in ['branch_devices.js','branch_device_settlements.js']:
    raw=(m/'backend/functions/auth'/name).read_text().replace('../../merchant-platform/','./merchant-platform/').replace('../shared/','./shared/');changes[name]=raw.encode()
   oldtext=old.read('branch_devices.js').decode();added=" if(input.action==='settlements')return require('./branch_device_settlements').route(event,input);\n";assert changes['branch_devices.js'].decode()==oldtext.replace(" const {s,m,authorization,common:staffGuards}=await employeeAccess",added+" const {s,m,authorization,common:staffGuards}=await employeeAccess",1)
   changes['merchant-platform/branch-profile-policy.js']=(m/'backend/merchant-platform/branch-profile-policy.js').read_bytes()
  candidate=p/(n+'-candidate.zip')
  with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED)as out:
   for e in old.infolist():out.writestr(copy.copy(e),changes.get(e.filename,old.read(e.filename)))
   for name,b in changes.items():
    if name not in old.namelist():out.writestr(name,b)
  with zipfile.ZipFile(candidate)as out:
   assert all(old.read(k)==out.read(k)for k in old.namelist()if k not in changes)
   for name in changes:
    if name.endswith('.js'):
     q=p/'syntax-check.js';q.write_bytes(changes[name]);subprocess.run(['node','--check',str(q)],check=True,capture_output=True)
  rows.append({'function':n,'changes':list(changes),'baseCodeSha256':json.loads((p/(n+'.private.json')).read_text())['CodeSha256'],'packageSha256':hashlib.sha256(candidate.read_bytes()).hexdigest(),'unrelatedEntriesPreserved':True})
(p/'packages.json').write_text(json.dumps(rows,indent=2));print(json.dumps(rows,indent=2))
