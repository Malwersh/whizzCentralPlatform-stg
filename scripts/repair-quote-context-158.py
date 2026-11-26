"""Repair only missing quote evidence in the captured staging producer; preserve all other ZIP entries."""
import copy,pathlib,zipfile,io,json,hashlib,base64,subprocess,sys,time
p=pathlib.Path('/private/tmp/financial-checkout-failure-158')
old=(p/'quote-original.zip').read_bytes(); cfg=json.loads((p/'quote-config.private.json').read_text())
anchor='            policyVersion: result.policyVersion,\n            referenceVersion: result.referenceVersion,'
z=zipfile.ZipFile(io.BytesIO(old));s=z.read('index.js').decode()
assert s.count(anchor)==1 and 'pricingContext:' not in s and 'pricingAt:' not in s
assert 'context: context2,\n            binding,' in s
s=s.replace(anchor,'            pricingContext: result.context,\n            pricingAt: result.at,\n'+anchor)
(p/'quote-candidate.js').write_text(s);subprocess.run(['node','--check',str(p/'quote-candidate.js')],check=True)
out=io.BytesIO()
with zipfile.ZipFile(out,'w') as dest:
 for item in z.infolist(): dest.writestr(copy.copy(item),s.encode() if item.filename=='index.js' else z.read(item.filename))
b=out.getvalue();(p/'quote-candidate.zip').write_bytes(b)
assert zipfile.ZipFile(io.BytesIO(b)).read('dispatch-settings-contract.js')==z.read('dispatch-settings-contract.js')
if '--apply' not in sys.argv: print('PREPARED: two evidence fields only');sys.exit()
import boto3
l=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda')
current=l.get_function_configuration(FunctionName=cfg['FunctionName'])
assert current['RevisionId']==cfg['RevisionId'] and current['CodeSha256']==cfg['CodeSha256']
r=l.update_function_code(FunctionName=cfg['FunctionName'],RevisionId=cfg['RevisionId'],ZipFile=b)
for _ in range(30):
 c=l.get_function_configuration(FunctionName=cfg['FunctionName'])
 if c['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert c['LastUpdateStatus']=='Successful'
assert c['CodeSha256']==base64.b64encode(hashlib.sha256(b).digest()).decode()
assert c['Environment']==cfg['Environment'] and c['Role']==cfg['Role']
receipt={'function':cfg['FunctionName'],'oldCodeSha256':cfg['CodeSha256'],'newCodeSha256':c['CodeSha256'],'status':'VERIFIED','changedFields':['pricingContext','pricingAt'],'environmentUnchanged':True,'roleUnchanged':True}
(p/'quote-repair-receipt.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
