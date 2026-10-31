"""Publish a read-only statement detail overlay, preserving live env/access/other files."""
import sys,pathlib,json,zipfile,hashlib,base64,copy,urllib.request,time
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/statement-211');p.mkdir(exist_ok=True);lam=session().client('lambda');name='staging-wizz-staff-service'
full=lam.get_function(FunctionName=name);before=full['Configuration'];assert before['LastUpdateStatus']=='Successful'
previousReceiptPath=root/'docs/statement-details-publication-211.json'
previous=json.loads(previousReceiptPath.read_text()) if previousReceiptPath.exists() else None
p=p/before['CodeSha256'].replace('/','_').replace('+','-')[:16];p.mkdir(exist_ok=True)
# Fresh immutable source and config snapshot before preparing the overlay.
(p/'base.config.private.json').write_text(json.dumps(before,default=str));raw=urllib.request.urlopen(full['Code']['Location'],timeout=60).read();(p/'base.zip').write_bytes(raw)
sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
assert sha(raw)==before['CodeSha256']
changes={n:(root/'backend/staff-service'/n).read_bytes() for n in ['settlement-runtime.js','merchant-payouts.js']}
with zipfile.ZipFile(p/'base.zip') as old:
 with zipfile.ZipFile(p/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for item in old.infolist():out.writestr(copy.copy(item),changes.get(item.filename,old.read(item.filename)))
  for n,b in changes.items():
   if n not in old.namelist():out.writestr(n,b)
 with zipfile.ZipFile(p/'candidate.zip') as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
candidate=(p/'candidate.zip').read_bytes();current=lam.get_function_configuration(FunctionName=name);assert current['RevisionId']==before['RevisionId'] and current['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT'
result=lam.update_function_code(FunctionName=name,RevisionId=current['RevisionId'],ZipFile=candidate,Publish=False)
receipt={'part':211,'function':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(candidate),'changedFiles':list(changes),'otherEntriesPreserved':True,'status':'UPDATING','moneyMutationRequested':False,'iamOrEnvironmentChanged':False}
if previous:receipt['priorVerifiedDeployments']=[*previous.get('priorVerifiedDeployments',[]),{'codeSha256':previous['codeSha256'],'status':previous['status']}]
doc=root/'docs/statement-details-publication-211.json'
def save():doc.write_text(json.dumps(receipt,indent=2)+'\n')
save()
for _ in range(90):
 after=lam.get_function_configuration(FunctionName=name)
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==sha(candidate)
for k in ['Runtime','Handler','Role','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage','Environment']:assert after.get(k)==before.get(k),(k,'CONFIGURATION_DRIFT')
# Missing authentication must be rejected before reaching a statement read.
r=lam.invoke(FunctionName=name,InvocationType='RequestResponse',Payload=json.dumps({'httpMethod':'GET','path':'/staff/settlement-schedules','queryStringParameters':{'view':'payout-statement'},'headers':{}}).encode());v=json.loads(r['Payload'].read());assert not r.get('FunctionError') and v.get('statusCode')==401
receipt.update(status='PUBLISHED_VERIFIED',configurationPreserved=True,negativeAuthSmoke=401);save();print(json.dumps(receipt))
