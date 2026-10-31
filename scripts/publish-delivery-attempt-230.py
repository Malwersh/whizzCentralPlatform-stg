"""Publish verified delivery-attempt metadata/UI boundaries to staging; preserve all other ZIP bytes/config."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,subprocess,os
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/attempt-230');l=session().client('lambda');sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
subprocess.run(['node','scripts/build-order-exception-runtime-229.cjs','--check'],cwd=root,check=True)
subprocess.run(['node','scripts/build-delivery-attempt-230.cjs','--check'],cwd=root,check=True)
subprocess.run(['node','scripts/prepare-delivery-attempt-230.cjs'],cwd=root,check=True)
assert json.loads((p/'access-result.json').read_text())['financialSettingsReadAllowed']
for file in ['live-tests.log','bundled-attempt-tests.log','all-wallet-final.log']:
 assert 'ℹ fail 0' in (p/file).read_text(),file
assert 'All tests passed!' in (p/'driver-tests-final.log').read_text()
changesets=[('financial',{'index.js':(p/'financial-candidate.js').read_bytes(),'order-exception-runtime-229.js':(root/'backend/shared/order-exception-runtime-229.js').read_bytes()}),('driver',{'lambda_driver_api_v2.js':(p/'driver-candidate.js').read_bytes(),'financial-accept-client.js':(root.parent/'whizzDrivers-stg/backend/financial-accept-client.js').read_bytes()}),('staff',{'_discount_review/central-staff/index.js':(p/'staff-candidate.js').read_bytes(),**{n:(root/'backend/staff-service'/n).read_bytes() for n in ['operational-settings.js','order-exception-settings.js','order-exception-settings-contract.js']}})]
r={'part':230,'status':'PUBLISHING','functions':[],'financialWritesByAgent':False,'scope':'STAGING_GENERAL_NEW_POLICY_ORDERS'};doc=root/'docs/delivery-attempt-publication-230.json'
def save():doc.write_text(json.dumps(r,indent=2)+'\n')
for label,changes in changesets:
 before=json.loads((p/(label+'-config.private.json')).read_text());name=before['FunctionName'];current=l.get_function_configuration(FunctionName=name)
 assert current['RevisionId']==before['RevisionId'] and current['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT '+name
 with zipfile.ZipFile(p/(label+'-base.zip')) as old:
  assert sha((p/(label+'-base.zip')).read_bytes())==before['CodeSha256']
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED) as out:
   for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
   for n,b in changes.items():
    if n not in old.namelist():out.writestr(n,b)
  with zipfile.ZipFile(p/(label+'-candidate.zip')) as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
 raw=(p/(label+'-candidate.zip')).read_bytes();l.update_function_code(FunctionName=name,RevisionId=before['RevisionId'],ZipFile=raw,Publish=False)
 for _ in range(60):
  after=l.get_function_configuration(FunctionName=name)
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==sha(raw)
 for k in ['Runtime','Handler','Role','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage','Environment']:assert before.get(k)==after.get(k),'CONFIG_DRIFT '+k
 r['functions'].append({'name':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedFiles':list(changes),'otherZipEntriesIdentical':True,'configurationPreserved':True});save();print('Published '+name,flush=True)
r['status']='PUBLISHED';save()
