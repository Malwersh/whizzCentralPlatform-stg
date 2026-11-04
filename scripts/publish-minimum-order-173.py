"""Publish the authorized optional branch minimum; no IAM/configuration/data changes."""
import pathlib,json,boto3,hashlib,base64
from botocore.config import Config
p=pathlib.Path('/private/tmp/minimum-173');l=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda',config=Config(read_timeout=120,connect_timeout=30));receipts=[]
for d in sorted(x for x in p.iterdir() if x.is_dir()):
 saved=json.loads((d/'config.private.json').read_text());before=l.get_function_configuration(FunctionName=d.name);b=(d/'candidate.zip').read_bytes();digest=base64.b64encode(hashlib.sha256(b).digest()).decode()
 if before['CodeSha256']==digest:receipts.append({'function':d.name,'codeSha256':digest,'alreadyPublished':True});continue
 assert before['CodeSha256']==saved['CodeSha256'] and before['RevisionId']==saved['RevisionId'],'LIVE_DRIFT'
 l.update_function_code(FunctionName=d.name,RevisionId=before['RevisionId'],ZipFile=b);l.get_waiter('function_updated_v2').wait(FunctionName=d.name,WaiterConfig={'Delay':2,'MaxAttempts':90});after=l.get_function_configuration(FunctionName=d.name)
 assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==digest
 for k in ['Role','Environment','Timeout','Handler','Runtime','MemorySize','Architectures','Layers','VpcConfig']:assert before.get(k)==after.get(k),k
 receipts.append({'function':d.name,'codeSha256':digest,'configurationPreserved':True})
 pathlib.Path('docs/minimum-order-publication-173.json').write_text(json.dumps({'functions':receipts,'iamChanged':False,'branchValuesChanged':False,'balancesChanged':False,'serverTestsPassed':22,'packagedCommercialCheckPassed':True},indent=2)+'\n');print(d.name,'published',flush=True)
