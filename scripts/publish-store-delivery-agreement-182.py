"""Coordinated staging code-only publication. Existing IAM, scopes and balances stay unchanged."""
import pathlib,json,boto3,hashlib,base64,re,datetime
from botocore.config import Config
p=pathlib.Path('/private/tmp/store-agreement-182');manifest=json.loads(pathlib.Path('docs/store-delivery-agreement-candidates-182.json').read_text())
for filename in ['full-node-tests.log','packaged-runtime-tests.log','actual-handler-tests.log']:
 s=(p/filename).read_text();assert re.search(r'fail 0\b',s) and not re.search(r'fail [1-9]',s),filename
l=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda',config=Config(connect_timeout=120,read_timeout=120))
rows=manifest['functions'];priority=['staging-driver-financial-accept','staging-cod-integration','staging-merchant-response-99','order-receiver-merchant-orders-staging-v1','WaveSystem_CreateDispatchJob','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','WizzUser-GetBusinesses-staging','WizzUser-GetBusiness-staging','WizzUser-DeliveryQuotes-staging','WizzUser-CreateOrder-staging','staging-wizz-staff-service'];assert set(priority)=={x['name'] for x in rows}
receipt={'part':182,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PUBLISHING','iamChanged':False,'configurationChanged':False,'ordersCreated':0,'financialDataWritten':False,'policySentOrAccepted':False,'functions':[]};doc=pathlib.Path('docs/store-delivery-agreement-publication-182.json');save=lambda:doc.write_text(json.dumps(receipt,indent=2)+'\n')
# Check every base before making the first change.
for row in rows:
 c=l.get_function_configuration(FunctionName=row['name']);assert c['CodeSha256']==row['baseCodeSha256'],'LIVE_CODE_DRIFT '+row['name'];assert c['LastUpdateStatus']=='Successful';baseline=json.loads((p/(row['name']+'.config.private.json')).read_text());assert c.get('Environment')==baseline.get('Environment'),'CONFIG_DRIFT'
save()
for name in priority:
 row=next(x for x in rows if x['name']==name);before=l.get_function_configuration(FunctionName=name);assert before['CodeSha256']==row['baseCodeSha256'];b=(p/row['candidate']).read_bytes();assert base64.b64encode(hashlib.sha256(b).digest()).decode()==row['codeSha256']
 l.update_function_code(FunctionName=name,RevisionId=before['RevisionId'],ZipFile=b);l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':90});after=l.get_function_configuration(FunctionName=name);assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==row['codeSha256']
 for key in ['Role','Environment','Handler','Timeout','Runtime','MemorySize','Architectures','Layers','VpcConfig']:assert before.get(key)==after.get(key),key
 receipt['functions'].append({'name':name,'codeSha256':after['CodeSha256'],'configurationPreserved':True});save();print(name,'VERIFIED',flush=True)
receipt.update(status='PUBLISHED_VERIFIED',completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),physicalAgreementOrderVerificationPending=True);save();print('All staging code overlays verified; no policy or money writes.',flush=True)
