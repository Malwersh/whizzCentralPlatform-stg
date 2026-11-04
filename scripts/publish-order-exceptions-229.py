"""Publish first OECSR policy/case slice. No invocation with user credentials or financial writes."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,subprocess,os
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/exceptions-229');l=session().client('lambda');sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
subprocess.run(['node','scripts/build-order-exception-runtime-229.cjs','--check'],cwd=root,check=True)
subprocess.run(['node','scripts/build-checkout-runtime-222.cjs','--check'],cwd=root,check=True)
subprocess.run(['node','scripts/prepare-order-exceptions-229.cjs'],cwd=root,check=True)
subprocess.run(['node','--test','backend/wallet-service/test/full-cash-lifecycle-matrix-219.test.cjs'],cwd=root,env={**os.environ,'LIFECYCLE_RUNTIME_219':str(p/'financial-candidate.js')},check=True,stdout=subprocess.DEVNULL)
subprocess.run(['node','scripts/test-checkout-entry-222.cjs'],cwd=root,env={**os.environ,'LIVE_FINANCE_ENV_223':str(p/'customer-config.private.json'),'CHECKOUT_ENTRY_CANDIDATE_224':str(p/'customer-candidate.js'),'DENY_LIFECYCLE_GET_224':'1','EXPECT_EXCEPTION_POLICY_229':'1'},check=True)
assert all(x['decision']=='allowed' for x in json.loads((p/'iam-review.json').read_text()))
receipt={'part':229,'status':'PUBLISHING','functions':[],'financialWritesByAgent':False,'permissionsChanged':False}
def save():(root/'docs/order-exceptions-publication-229.json').write_text(json.dumps(receipt,indent=2)+'\n')
for label,name,changes in [('financial','staging-driver-financial-accept',{'index.js':(p/'financial-candidate.js').read_bytes(),'order-exception-runtime-229.js':(root/'backend/shared/order-exception-runtime-229.js').read_bytes()}),('customer','WizzUser-CreateOrder-staging',{'_discount_review/user-create-order/index.js':(p/'customer-candidate.js').read_bytes(),'checkout-finance-runtime-222.js':(root/'backend/shared/checkout-finance-runtime-222.js').read_bytes()})]:
 before=json.loads((p/(label+'-config.private.json')).read_text());current=l.get_function_configuration(FunctionName=name);assert current['RevisionId']==before['RevisionId'] and current['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT'
 with zipfile.ZipFile(p/(label+'-base.zip')) as old:
  assert sha((p/(label+'-base.zip')).read_bytes())==before['CodeSha256']
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED) as out:
   for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
   for n,b in changes.items():
    if n not in old.namelist():out.writestr(n,b)
  with zipfile.ZipFile(p/(label+'-candidate.zip')) as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
 raw=(p/(label+'-candidate.zip')).read_bytes();l.update_function_code(FunctionName=name,RevisionId=before['RevisionId'],ZipFile=raw,Publish=False)
 for _ in range(90):
  after=l.get_function_configuration(FunctionName=name)
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==sha(raw)
 for k in ['Runtime','Handler','Role','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage','Environment']:assert before.get(k)==after.get(k),'CONFIG_DRIFT '+k
 receipt['functions'].append({'name':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedFiles':list(changes),'otherZipEntriesIdentical':True,'configurationPreserved':True});save()
receipt['status']='PUBLISHED_GENERAL_STAGING_NEW_ORDER_POLICY_AND_RETURN_CASES';save();print(json.dumps(receipt))
