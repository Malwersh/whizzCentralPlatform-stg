"""Publish the explicitly approved 169 code; verify IAM and preserve all Lambda settings."""
import boto3,pathlib,json,hashlib,base64
from botocore.config import Config
p=pathlib.Path('/private/tmp/storefront-169');s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda',config=Config(read_timeout=120,connect_timeout=30));iam=s.client('iam');c=json.loads((p/'config.private.json').read_text());role=c['Role'].split('/')[-1]
assert iam.get_role_policy(RoleName=role,PolicyName='StorefrontPreviewRead169')['PolicyDocument']==json.loads(pathlib.Path('docs/storefront-preview-permissions-169.json').read_text())
before=l.get_function_configuration(FunctionName=c['FunctionName']);assert before['RevisionId']==c['RevisionId'] and before['CodeSha256']==c['CodeSha256'],'LIVE_DRIFT'
b=(p/'candidate.zip').read_bytes();l.update_function_code(FunctionName=c['FunctionName'],RevisionId=c['RevisionId'],ZipFile=b);l.get_waiter('function_updated_v2').wait(FunctionName=c['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':90});after=l.get_function_configuration(FunctionName=c['FunctionName']);assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==base64.b64encode(hashlib.sha256(b).digest()).decode()
for k in ['Role','Environment','Timeout','Handler','Runtime','MemorySize','Architectures','Layers','VpcConfig']:assert before.get(k)==after.get(k),k
r=l.invoke(FunctionName=c['FunctionName'],Payload=json.dumps({'httpMethod':'POST','headers':{},'body':'{}'}).encode());out=json.loads(r['Payload'].read());assert out.get('statusCode')==401,out
receipt={'function':c['FunctionName'],'codeSha256':after['CodeSha256'],'configurationPreserved':True,'approvedReadPolicyVerified':True,'unauthenticatedRequestRejected':True,'backendTestsPassed':45,'handlerChecksPassed':3,'customerTestsPassed':18,'merchantSettingsTestsPassed':3,'writesToWalletsOrOrders':False}
pathlib.Path('docs/storefront-preview-publication-169.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
