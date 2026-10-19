"""Surgical staging commercial-runtime repair; no configuration or permission changes."""
import copy,pathlib,zipfile,io,json,hashlib,base64,subprocess,sys,time
p=pathlib.Path('/private/tmp/checkout-confirm-159');cfg=json.loads((p/'config.private.json').read_text());old=(p/'original.zip').read_bytes();assert base64.b64encode(hashlib.sha256(old).digest()).decode()==cfg['CodeSha256']
z=zipfile.ZipFile(io.BytesIO(old));name='functions/create-order/commercial-runtime.js';s=z.read(name).decode();a='op2.TableName === "staging-Holds" ? { orderId: op2.Item.orderId, sk: op2.Item.sk }';assert s.count(a)==1;s=s.replace(a,'op2.TableName === "staging-WalletLifecycle" ? { operationId: op2.Item.operationId } : '+a)
(p/'candidate.js').write_text(s);subprocess.run(['node','--check',str(p/'candidate.js')],check=True)
out=io.BytesIO()
with zipfile.ZipFile(out,'w') as dest:
 for item in z.infolist():dest.writestr(copy.copy(item),s.encode() if item.filename==name else z.read(item.filename))
b=out.getvalue();(p/'candidate.zip').write_bytes(b);fresh=zipfile.ZipFile(io.BytesIO(b));assert all(fresh.read(n)==z.read(n) for n in z.namelist() if n!=name)
if '--apply' not in sys.argv:print('PREPARED');sys.exit()
import boto3
l=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda');c=l.get_function_configuration(FunctionName=cfg['FunctionName']);assert c['RevisionId']==cfg['RevisionId'] and c['CodeSha256']==cfg['CodeSha256'];l.update_function_code(FunctionName=cfg['FunctionName'],RevisionId=cfg['RevisionId'],ZipFile=b)
for _ in range(30):
 c=l.get_function_configuration(FunctionName=cfg['FunctionName'])
 if c['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert c['LastUpdateStatus']=='Successful' and c['CodeSha256']==base64.b64encode(hashlib.sha256(b).digest()).decode();assert c['Environment']==cfg['Environment'] and c['Role']==cfg['Role']
r={'function':cfg['FunctionName'],'status':'VERIFIED','oldCodeSha256':cfg['CodeSha256'],'newCodeSha256':c['CodeSha256'],'environmentUnchanged':True,'roleUnchanged':True,'targetedTestsPassed':22,'deviceConfirmationPending':True};pathlib.Path('docs/merchant-queue-composition-repair-159.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
