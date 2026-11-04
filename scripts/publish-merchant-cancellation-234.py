"""Publish bounded tested exception-case entries, preserving existing configuration and other bytes."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,subprocess
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/merchant-cancel-234');l=session().client('lambda');sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
for script in ['build-order-exception-runtime-229.cjs']:subprocess.run(['node','scripts/'+script,'--check'],cwd=root,check=True)
for name in ['wallet-tests.log','captured-lifecycle-tests.log','bundled-engine-tests.log','staff-tests.log']:assert 'ℹ fail 0'in(p/name).read_text(),name
for name in ['adapter-tests.log','browser.log']:assert 'PASS 'in(p/name).read_text(),name
for label in ['merchant']:
 assert 'All tests passed!'in(p/(label+'-tests.log')).read_text()
 assert '✓ Built'in(p/(label+'-build.log')).read_text()
assert json.loads((p/'monitor-update.json').read_text())['permissionsUnchanged']
subprocess.run(['node','scripts/prepare-merchant-cancellation-234.cjs'],cwd=root,check=True)
changesets=[('financial',{'index.js':(p/'financial-candidate.js').read_bytes(),'order-exception-runtime-229.js':(root/'backend/shared/order-exception-runtime-229.js').read_bytes()}),('staff',{'order-exception-cases.js':(root/'backend/staff-service/order-exception-cases.js').read_bytes()}),('merchant-auth',{'order_returns.js':(p/'merchant-auth-candidate.js').read_bytes()})]
changesets.append(('merchant-orders',{'merchant_order_handler.js':(p/'merchant-orders-candidate.js').read_bytes()}))
r={'part':234,'status':'PUBLISHING','functions':[],'financialWritesByAgent':False,'scope':'STAGING_GENERAL_NEW_POLICY_ORDERS'};doc=root/'docs/merchant-cancellation-publication-234.json'
def save():doc.write_text(json.dumps(r,indent=2)+'\n')
for label,changes in changesets:
 before=json.loads((p/(label+'-config.private.json')).read_text());name=before['FunctionName'];current=l.get_function_configuration(FunctionName=name)
 assert current['CodeSha256']==before['CodeSha256'],'LIVE_CODE_DRIFT '+name
 with zipfile.ZipFile(p/(label+'-base.zip'))as old:
  assert sha((p/(label+'-base.zip')).read_bytes())==before['CodeSha256']
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
   for n,b in changes.items():
    if n not in old.namelist():out.writestr(n,b)
  with zipfile.ZipFile(p/(label+'-candidate.zip'))as out:assert all(old.read(n)==out.read(n)for n in old.namelist()if n not in changes)
 raw=(p/(label+'-candidate.zip')).read_bytes();l.update_function_code(FunctionName=name,RevisionId=current['RevisionId'],ZipFile=raw,Publish=False)
 for _ in range(60):
  after=l.get_function_configuration(FunctionName=name)
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha(raw)
 for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage']:assert current.get(k)==after.get(k),'CONFIG_DRIFT '+k
 r['functions'].append({'name':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedFiles':list(changes),'otherZipEntriesIdentical':True,'configurationPreserved':True});save();print('Published '+name,flush=True)
r['status']='PUBLISHED';save()
