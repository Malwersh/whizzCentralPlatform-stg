"""Read-only identity policy checks for hosted financial paths and delegated push validation."""
import json,os,pathlib,sys,time,boto3
from botocore.config import Config
OUT=pathlib.Path(sys.argv[1]);inventory=json.loads((OUT/'inventory.private.json').read_text());functions={r['FunctionName']:r for r in inventory['functions']}
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');iam=s.client('iam',config=Config(retries={'max_attempts':5,'mode':'adaptive'}))
cases=[];prefix='arn:aws:dynamodb:us-east-1:699561669180:table/'
def add(fn,action,resource,key=None,attributes=None):cases.append({'function':fn,'role':functions[fn]['Role'],'action':action,'resource':resource,**({'leadingKey':key} if key else {}),**({'attributes':attributes} if attributes else {})})
jobs=prefix+'WizzDispatchJobs_staging';orders=prefix+'WizzOrders';offers=prefix+'WaveOffers_staging';staff=prefix+'staging-PlatformStaff'
for name in ['WaveSystem_CreateDispatchJob','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout']:
 for action in ['dynamodb:GetItem','dynamodb:ConditionCheckItem','dynamodb:PutItem','dynamodb:UpdateItem']:add(name,action,jobs,'synthetic-order')
 for action in ['dynamodb:GetItem','dynamodb:ConditionCheckItem']:add(name,action,orders,'ORDER#synthetic')
 for action in ['dynamodb:GetItem','dynamodb:ConditionCheckItem','dynamodb:PutItem','dynamodb:UpdateItem']:add(name,action,offers,'synthetic-order')
 for table,key in [('WhizzMerchants_Businesses','synthetic-branch'),('staging-AccountDeletion','BUSINESS_LIFECYCLE#MERCHANT#synthetic'),('WhizzDrivers_staging','synthetic-driver'),('WizzDriverLiveState_staging','synthetic-driver')]:
  for action in ['dynamodb:GetItem','dynamodb:ConditionCheckItem']:add(name,action,prefix+table,key)
 for key in ['OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS','OPERATIONAL_SETTINGS#DELIVERY_PRICING']:add(name,'dynamodb:GetItem',staff,key)
add('WaveSystem_HandleWaveTimeout','dynamodb:Scan',jobs)
for action in ['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem']:add('WaveSystem_HandleWaveTimeout',action,jobs,'SYSTEM#DISPATCH_HOST')
add('WaveSystem_HandleWaveTimeout','lambda:InvokeFunction','arn:aws:lambda:us-east-1:699561669180:function:WaveSystem_StartWave')
add('WaveSystem_StartWave','cognito-idp:AdminGetUser','arn:aws:cognito-idp:us-east-1:699561669180:userpool/us-east-1_RGTqUXF5C')
if functions['WaveSystem_StartWave']['routingSecretArn']:add('WaveSystem_StartWave','secretsmanager:GetSecretValue',functions['WaveSystem_StartWave']['routingSecretArn'])
for name in ['DriversApi-staging','wizzcentral-notifications-staging-pushSendWaveOffer']:add(name,'lambda:InvokeFunction','arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept')
# Notification proof delegation must not need broader financial table reads.
for table,key in [('WizzOrders','ORDER#synthetic'),('staging-Holds','synthetic-order'),('staging-Wallets','WALLET#PLATFORM')]:add('wizzcentral-notifications-staging-pushSendWaveOffer','dynamodb:GetItem',prefix+table,key)
rows=[]
for case in cases:
 context=[{'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':['SPECIFIC_ATTRIBUTES']}]
 if case.get('leadingKey'):context.append({'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[case['leadingKey']]})
 response=iam.simulate_principal_policy(PolicySourceArn=case['role'],ActionNames=[case['action']],ResourceArns=[case['resource']],ContextEntries=context)['EvaluationResults'][0]
 rows.append({**case,'decision':response['EvalDecision'],'missingContext':response.get('MissingContextValues',[]),'boundary':response.get('PermissionsBoundaryDecisionDetail')});time.sleep(.15)
report={'part':156,'readOnly':True,'applied':False,'results':rows,'limitation':'Identity-policy simulation only; not resource policy/SCP/network/device proof. Unprojected reads are tested as actual strongGet calls currently use them.'}
p=OUT/'access-simulations.private.json';p.write_text(json.dumps(report,indent=2)+'\n');os.chmod(p,0o600)
print(json.dumps({'cases':len(rows),'allowed':sum(r['decision']=='allowed' for r in rows),'implicitDeny':sum(r['decision']=='implicitDeny' for r in rows),'explicitDeny':sum(r['decision']=='explicitDeny' for r in rows),'missingContextCases':sum(bool(r['missingContext']) for r in rows),'applied':False}))
