"""Enable the already-published staff/owner delivery policy workflow on staging only."""
import boto3,pathlib,json
from botocore.config import Config
l=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda',config=Config(connect_timeout=8,read_timeout=60));name='staging-wizz-staff-service';before=l.get_function_configuration(FunctionName=name);assert before['FunctionArn'].startswith('arn:aws:lambda:us-east-1:699561669180:');env=before['Environment']['Variables'];assert env.get('COMMERCIAL_ADMIN_ENABLED')=='true';new={**env,'DELIVERY_FUNDING_MANAGEMENT_ENABLED':'true'};assert len(json.dumps(new,separators=(',',':')).encode())<4096
p=pathlib.Path('/private/tmp/funded-delivery-175');p.mkdir(exist_ok=True);(p/'staff-management-before.private.json').write_text(json.dumps(before,default=str));(p/'staff-management-before.private.json').chmod(0o600)
if env!=new:
 l.update_function_configuration(FunctionName=name,RevisionId=before['RevisionId'],Environment={'Variables':new});l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':90})
after=l.get_function_configuration(FunctionName=name);assert after['Environment']['Variables']==new
for k in ['CodeSha256','Role','Handler','Runtime','Timeout','MemorySize','Architectures','Layers','VpcConfig']:assert before.get(k)==after.get(k),k
receipt={'function':name,'changedEnvironmentKeys':['DELIVERY_FUNDING_MANAGEMENT_ENABLED'],'managementEnabled':True,'codeAndIamPreserved':True,'otherEnvironmentKeysPreserved':True,'policyCreated':False,'ownerConsentRecorded':False,'balancesChanged':False,'freshOrderAdmissionEnabled':False};pathlib.Path('docs/delivery-policy-management-activation-175.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
