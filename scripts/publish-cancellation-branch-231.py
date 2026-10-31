"""Keep merchant branch binding in financial writer; avoid extending adapter order-read access."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/cancellation-231');l=session().client('lambda');sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode();doc=root/'docs/customer-cancellation-publication-231.json';r=json.loads(doc.read_text())
assert 'ℹ fail 0' in(p/'engine-tests-final.log').read_text();assert 'PASS ' in(p/'merchant-adapter-tests-final.log').read_text()
for label,changes in [('financial',{'index.js':(p/'financial-candidate.js').read_bytes(),'order-exception-runtime-229.js':(root/'backend/shared/order-exception-runtime-229.js').read_bytes()}),('merchant-auth',{'order_returns.js':(p/'merchant-auth-candidate.js').read_bytes()})]:
 name=json.loads((p/(label+'-config.private.json')).read_text())['FunctionName'];record=next(x for x in r['functions']if x['name']==name);before=l.get_function_configuration(FunctionName=name);assert before['CodeSha256']==record['codeSha256'],'LIVE_DRIFT'
 with zipfile.ZipFile(p/(label+'-candidate.zip'))as old:
  assert sha((p/(label+'-candidate.zip')).read_bytes())==record['codeSha256']
  with zipfile.ZipFile(p/(label+'-branch-fix.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  with zipfile.ZipFile(p/(label+'-branch-fix.zip'))as out:assert all(old.read(n)==out.read(n)for n in old.namelist()if n not in changes)
 raw=(p/(label+'-branch-fix.zip')).read_bytes();l.update_function_code(FunctionName=name,RevisionId=before['RevisionId'],ZipFile=raw,Publish=False)
 for _ in range(60):
  after=l.get_function_configuration(FunctionName=name)
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha(raw)
 for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Architectures']:assert before.get(k)==after.get(k)
 record['previousPublishedCodeSha256']=record['codeSha256'];record['codeSha256']=sha(raw);record['branchBinding']='Verified branch and order relationship inside financial writer; merchant adapter needs no WizzOrders read permission';doc.write_text(json.dumps(r,indent=2)+'\n');print('Verified branch binding published: '+name,flush=True)
