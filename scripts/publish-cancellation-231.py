"""Publish bounded customer cancellation slice to actual staging entrypoints. No real-order commands."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,subprocess,os
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/cancellation-231');s=session();l=s.client('lambda');sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
subprocess.run(['node','scripts/build-order-exception-runtime-229.cjs','--check'],cwd=root,check=True)
subprocess.run(['node','scripts/prepare-cancellation-231.cjs'],cwd=root,check=True)
for name in ['all-wallet.log','engine-tests.log','bundled-engine-tests.log','live-lifecycle-tests.log']:assert 'ℹ fail 0' in (p/name).read_text(),name
for name in ['entry-tests.log','merchant-adapter-tests.log']:assert 'PASS ' in (p/name).read_text(),name
for name in ['customer-tests.log','merchant-tests.log']:assert 'All tests passed!' in (p/name).read_text(),name
assert json.loads((p/'access-result.json').read_text())['scopedIdentityAndInvocationAllowed']
changesets=[('financial',{'index.js':(p/'financial-candidate.js').read_bytes(),'order-exception-runtime-229.js':(root/'backend/shared/order-exception-runtime-229.js').read_bytes()}),('merchant-auth',{'order_returns.js':(p/'merchant-auth-candidate.js').read_bytes()}),('merchant-orders',{'merchant_order_handler.js':(p/'merchant-orders-candidate.js').read_bytes()}),('order',{'dist/index.js':(p/'order-candidate.js').read_bytes(),'financial-cancellation-client.js':(root/'backend/order-service/financial-cancellation-client.js').read_bytes()})]
r={'part':231,'status':'PUBLISHING','functions':[],'financialWritesByAgent':False,'scope':'STAGING_NEW_POLICY_CUSTOMER_CANCELLATION'};doc=root/'docs/customer-cancellation-publication-231.json'
def save():doc.write_text(json.dumps(r,indent=2)+'\n')
for label,changes in changesets:
 before=json.loads((p/(label+'-config.private.json')).read_text());name=before['FunctionName'];current=l.get_function_configuration(FunctionName=name);assert current['RevisionId']==before['RevisionId']and current['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT '+name
 with zipfile.ZipFile(p/(label+'-base.zip'))as old:
  assert sha((p/(label+'-base.zip')).read_bytes())==before['CodeSha256']
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
   for n,b in changes.items():
    if n not in old.namelist():out.writestr(n,b)
  with zipfile.ZipFile(p/(label+'-candidate.zip'))as out:assert all(out.read(n)==old.read(n)for n in old.namelist()if n not in changes)
 raw=(p/(label+'-candidate.zip')).read_bytes();l.update_function_code(FunctionName=name,RevisionId=before['RevisionId'],ZipFile=raw,Publish=False)
 for _ in range(60):
  after=l.get_function_configuration(FunctionName=name)
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha(raw)
 for k in ['Runtime','Handler','Role','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage','Environment']:assert before.get(k)==after.get(k),'CONFIG_DRIFT '+k
 r['functions'].append({'name':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedFiles':list(changes),'otherZipEntriesIdentical':True,'configurationPreserved':True});save();print('Published '+name,flush=True)
r['status']='PUBLISHED';save()
