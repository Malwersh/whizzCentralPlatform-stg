"""Update only the monitor's code for merchant/superseded cases; preserve all resource policies."""
import sys,pathlib,json,time,copy
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
s=session();cf=s.client('cloudformation');l=s.client('lambda');root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/merchant-cancel-234');name='staging-order-exception-cases-access-232';raw=cf.get_template(StackName=name,TemplateStage='Original')['TemplateBody'];template=json.loads(raw)if isinstance(raw,str)else raw;before=copy.deepcopy(template);template['Resources']['Monitor']['Properties']['Code']['ZipFile']=(root/'backend/shared/exception-case-sla-232.js').read_text();check=copy.deepcopy(template);check['Resources']['Monitor']['Properties']['Code']=before['Resources']['Monitor']['Properties']['Code'];assert check==before
cf.validate_template(TemplateBody=json.dumps(template));config=l.get_function_configuration(FunctionName='staging-order-exception-sla-232');(p/'monitor-template.json').write_text(json.dumps(template,indent=2))
if '--apply'not in sys.argv:print('PASS monitor template changes only code; all roles, permissions, schedule and config identical');sys.exit()
try:
 cf.update_stack(StackName=name,TemplateBody=json.dumps(template),Capabilities=['CAPABILITY_IAM']);cf.get_waiter('stack_update_complete').wait(StackName=name,WaiterConfig={'Delay':5,'MaxAttempts':120})
except cf.exceptions.ClientError as e:
 if 'No updates are to be performed'not in str(e):raise
new=l.get_function_configuration(FunctionName=config['FunctionName'])
for k in ['Role','Environment','Handler','Runtime','Timeout','MemorySize','Architectures']:assert config.get(k)==new.get(k)
r={'stack':name,'stackStatus':cf.describe_stacks(StackName=name)['Stacks'][0]['StackStatus'],'previousCodeSha256':config['CodeSha256'],'codeSha256':new['CodeSha256'],'onlyMonitorCodeChanged':True,'permissionsUnchanged':True,'financialWritesByAgent':False};(p/'monitor-update.json').write_text(json.dumps(r,indent=2));print('PASS metadata-only monitor updated for merchant and superseded cases')
