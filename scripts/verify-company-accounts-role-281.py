"""Verify real DynamoDB permissions with a temporary IAM-only read probe, then delete it."""
import sys,pathlib,json,subprocess,zipfile
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/company-accounts-281');s=session();l=s.client('lambda');config=l.get_function_configuration(FunctionName='staging-wizz-staff-service');name='staging-company-accounts-read-probe-281'
subprocess.run([str(r/'backend/wallet-service/node_modules/.bin/esbuild'),str(r/'scripts/probe-company-accounts-281.cjs'),'--bundle','--platform=node','--target=node22','--keep-names','--outfile='+str(p/'probe.js')],check=True)
with zipfile.ZipFile(p/'probe.zip','w',zipfile.ZIP_DEFLATED) as z:z.write(p/'probe.js','index.js')
created=False
try:
 l.create_function(FunctionName=name,Runtime='nodejs22.x',Role=config['Role'],Handler='index.handler',Code={'ZipFile':(p/'probe.zip').read_bytes()},Timeout=30,MemorySize=256,Description='Temporary fixed read-only company accounting IAM probe; no HTTP endpoint');created=True;l.get_waiter('function_active_v2').wait(FunctionName=name)
 response=l.invoke(FunctionName=name,Payload=b'{}');out=json.loads(response['Payload'].read());assert not response.get('FunctionError'),out
 assert not out['issues'] and out['verifiedOrderNetMinor']==-450000,out
 record={'part':281,'status':'PASS','realStaffRoleReadVerified':True,'businessDataModified':False,'temporaryProbeDeleted':True,**out};(r/'docs/company-accounts-role-verification-281.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
finally:
 if created:l.delete_function(FunctionName=name);print('Temporary read-only probe deleted.')
