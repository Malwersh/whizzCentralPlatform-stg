"""Prepare exact minimal reviewed permissions and simulate without saving to IAM."""
import hashlib,json,os,pathlib,sys,boto3
from botocore.config import Config
OUT=pathlib.Path(sys.argv[1]);inv=json.loads((OUT/'inventory.private.json').read_text());f={r['FunctionName']:r for r in inv['functions']};table='arn:aws:dynamodb:us-east-1:699561669180:table/'
creator=f['WaveSystem_CreateDispatchJob'];notification=f['wizzcentral-notifications-staging-pushSendWaveOffer'];target='arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept'
def statement(sid,actions,resource,keys=None):return {'Sid':sid,'Effect':'Allow','Action':actions,'Resource':resource,**({'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':keys},'Null':{'dynamodb:LeadingKeys':'false'}}} if keys else {})}
roles=[{'roleArn':creator['Role'],'policyName':'FinancialCycleCreator156','functions':['WaveSystem_CreateDispatchJob'],'policy':{'Version':'2012-10-17','Statement':[
 statement('ValidateBranch',['dynamodb:ConditionCheckItem'],table+'WhizzMerchants_Businesses'),
 statement('CaptureDispatchPolicy',['dynamodb:GetItem','dynamodb:ConditionCheckItem'],table+'staging-PlatformStaff',['OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS']),
 statement('FenceMerchantDeletion',['dynamodb:ConditionCheckItem'],table+'staging-AccountDeletion',['BUSINESS_LIFECYCLE#MERCHANT#*','ACCOUNT_LIFECYCLE#MERCHANT#*'])]}},
 {'roleArn':notification['Role'],'policyName':'FinancialPushValidation156','functions':next(r['functions'] for r in inv['roles'] if r['arn']==notification['Role']),'policy':{'Version':'2012-10-17','Statement':[statement('InvokeReadOnlyProofAction',['lambda:InvokeFunction'],target)]}}]
session=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');iam=session.client('iam',config=Config(retries={'max_attempts':5,'mode':'adaptive'}));results=[]
for role in roles:
 for st in role['policy']['Statement']:
  keys=st.get('Condition',{}).get('ForAllValues:StringLike',{}).get('dynamodb:LeadingKeys',['synthetic-branch'])
  for key in keys:
   key=key.replace('*','synthetic')
   for action in st['Action']:
    context=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[key]},{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':['__UNPROJECTED_READ__']},{'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':['ALL_ATTRIBUTES']}]
    req={'PolicySourceArn':role['roleArn'],'ActionNames':[action],'ResourceArns':[st['Resource']],'ContextEntries':context}
    before=iam.simulate_principal_policy(**req)['EvaluationResults'][0]
    after=iam.simulate_principal_policy(**req,PolicyInputList=[json.dumps(role['policy'])])['EvaluationResults'][0]
    assert before['EvalDecision']=='implicitDeny' and after['EvalDecision']=='allowed' and not after.get('MissingContextValues')
    results.append({'roleArn':role['roleArn'],'action':action,'resource':st['Resource'],'leadingKey':key,'before':before['EvalDecision'],'candidate':after['EvalDecision']})
 for path in [OUT/(role['roleArn'].rsplit('/',1)[-1]+'.policies.private.json')]:role['baselineRolePolicySnapshotSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
report={'part':156,'reviewOnly':True,'applied':False,'roles':roles,'simulations':results,'excluded':['New notification financial table reads','Wallet/ledger/hold writes','New roles/tables/queues/rules','API Gateway route changes','Environment changes or admission activation'],'limitation':'InvokeFunction IAM cannot restrict the action payload. Existing financial mutations still require authenticated tokens and their existing server gates; the new tokenless action validates only persisted notification proof and returns reference metadata.'}
p=OUT/'permission-candidates.json';p.write_text(json.dumps(report,indent=2)+'\n');os.chmod(p,0o600)
print(json.dumps({'candidateRoles':len(roles),'statements':sum(len(r['policy']['Statement']) for r in roles),'requiredDeniedCasesResolved':len(results),'applied':False}))
