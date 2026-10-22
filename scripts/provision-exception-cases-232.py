"""Provision only staging exception metadata access, approved policy and deadline monitor."""
import sys,pathlib,json,time,datetime,hashlib
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/exceptions-232');s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180'
cf=s.client('cloudformation');iam=s.client('iam');ddb=s.resource('dynamodb');region='us-east-1';account='699561669180';arn=lambda t:f'arn:aws:dynamodb:{region}:{account}:table/{t}'
configs={x:json.loads((p/(x+'-config.private.json')).read_text())for x in ['financial','staff']}
role=lambda label:configs[label]['Role'].split('/')[-1]
def statement(actions,resources,keys=None):
 x={'Effect':'Allow','Action':actions,'Resource':resources}
 if keys:x['Condition']={'ForAllValues:StringLike':{'dynamodb:LeadingKeys':keys}}
 return x
staff=[statement(['lambda:InvokeFunction'],configs['financial']['FunctionArn']),statement(['dynamodb:Query'],arn('staging-WalletLifecycle')+'/index/ByDue',['ORDER_EXCEPTIONS_OPEN']),statement(['dynamodb:GetItem'],arn('staging-WalletLifecycle'),['EXCEPTION_CASE#*']),statement(['dynamodb:GetItem','dynamodb:Query'],arn('staging-Holds')),statement(['dynamodb:GetItem'],arn('WizzOrders'),['ORDER#*']),statement(['dynamodb:Query'],arn('WizzOrders')+'/index/GSI_OrderNumber',['ORD*'])]
financial=[statement(['dynamodb:GetItem','dynamodb:ConditionCheckItem'],arn('staging-PlatformStaff'),['EMPLOYEE#*','OPERATIONAL_SETTINGS#ORDER_EXCEPTION_CASES']),statement(['cognito-idp:AdminGetUser'],f'arn:aws:cognito-idp:{region}:{account}:userpool/us-east-1_wz7vwZZxz')]
worker=[statement(['dynamodb:Query'],arn('staging-WalletLifecycle')+'/index/ByDue',['ORDER_EXCEPTIONS_OPEN']),statement(['dynamodb:GetItem','dynamodb:PutItem'],arn('staging-WalletLifecycle'),['EXCEPTION_CASE#*']),statement(['dynamodb:GetItem','dynamodb:ConditionCheckItem'],arn('staging-Holds')),statement(['dynamodb:PutItem'],arn('staging-AuditLog'),['date#*']),statement(['logs:CreateLogStream','logs:PutLogEvents'],f'arn:aws:logs:{region}:{account}:log-group:/aws/lambda/staging-order-exception-sla-232:*')]
policy=lambda rows:{'Version':'2012-10-17','Statement':rows}
resources={}
for label,rows in [('staff',staff),('financial',financial)]:resources[label.title()+'Access']={'Type':'AWS::IAM::ManagedPolicy','Properties':{'Description':'Staging exception cases scoped metadata and verified writer access','Roles':[role(label)],'PolicyDocument':policy(rows)}}
resources['MonitorRole']={'Type':'AWS::IAM::Role','Properties':{'AssumeRolePolicyDocument':policy([{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]),'Policies':[{'PolicyName':'metadata-only','PolicyDocument':policy(worker)}]}}
resources['MonitorLogs']={'Type':'AWS::Logs::LogGroup','Properties':{'LogGroupName':'/aws/lambda/staging-order-exception-sla-232','RetentionInDays':30}}
resources['Monitor']={'Type':'AWS::Lambda::Function','DependsOn':['MonitorLogs'],'Properties':{'FunctionName':'staging-order-exception-sla-232','Runtime':'nodejs20.x','Handler':'index.exceptionCaseSlaHandler','Role':{'Fn::GetAtt':['MonitorRole','Arn']},'Timeout':45,'MemorySize':128,'ReservedConcurrentExecutions':1,'Environment':{'Variables':{'STAGE':'staging','EXCEPTION_CASE_SLA_MODE':'REQUIRED'}},'Code':{'ZipFile':(root/'backend/shared/exception-case-sla-232.js').read_text()}}}
resources['Schedule']={'Type':'AWS::Events::Rule','Properties':{'Name':'staging-order-exception-sla-232','ScheduleExpression':'rate(1 minute)','State':'ENABLED','Targets':[{'Arn':{'Fn::GetAtt':['Monitor','Arn']},'Id':'ExceptionDeadlineMonitor','Input':'{"action":"tick"}'}]}}
resources['SchedulePermission']={'Type':'AWS::Lambda::Permission','Properties':{'FunctionName':{'Ref':'Monitor'},'Action':'lambda:InvokeFunction','Principal':'events.amazonaws.com','SourceArn':{'Fn::GetAtt':['Schedule','Arn']}}}
template={'AWSTemplateFormatVersion':'2010-09-09','Description':'Staging exception metadata access and deadline alerts. No monitor financial write rights.','Resources':resources};raw=json.dumps(template);assert len(raw.encode())<51200;(p/'metadata-stack.json').write_text(json.dumps(template,indent=2));cf.validate_template(TemplateBody=raw)
# Simulate the complete new monitoring policy before any deployment.
checks=[]
for action,res,key,expected in [('dynamodb:Query',arn('staging-WalletLifecycle')+'/index/ByDue','ORDER_EXCEPTIONS_OPEN','allowed'),('dynamodb:PutItem',arn('staging-WalletLifecycle'),'EXCEPTION_CASE#synthetic','allowed'),('dynamodb:PutItem',arn('staging-Wallets'),'DRIVER#synthetic','implicitDeny'),('dynamodb:PutItem',arn('WizzOrders'),'ORDER#synthetic','implicitDeny'),('dynamodb:PutItem',arn('staging-Holds'),'synthetic','implicitDeny'),('dynamodb:PutItem',arn('staging-LedgerEntries'),'synthetic','implicitDeny'),('dynamodb:Query',arn('staging-WalletLifecycle')+'/index/ByDue','PENDING','implicitDeny')]:
 r=iam.simulate_custom_policy(PolicyInputList=[json.dumps(policy(worker))],ActionNames=[action],ResourceArns=[res],ContextEntries=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyValues':[key],'ContextKeyType':'stringList'}]);decision=r['EvaluationResults'][0]['EvalDecision'];assert decision==expected,(action,res,decision);checks.append({'action':action,'resource':res,'key':key,'decision':decision})
(p/'worker-policy-simulation.json').write_text(json.dumps(checks,indent=2))
if '--apply' not in sys.argv:print('Validated metadata stack and seven monitor permission boundaries; no deployment.');sys.exit()
name='staging-order-exception-cases-access-232'
try:cf.describe_stacks(StackName=name);exists=True
except cf.exceptions.ClientError as e:
 if 'does not exist' not in str(e):raise
 exists=False
try:
 (cf.update_stack if exists else cf.create_stack)(StackName=name,TemplateBody=raw,Capabilities=['CAPABILITY_IAM'])
 waiter=cf.get_waiter('stack_update_complete'if exists else'stack_create_complete');waiter.wait(StackName=name,WaiterConfig={'Delay':5,'MaxAttempts':120})
except cf.exceptions.ClientError as e:
 if 'No updates are to be performed'not in str(e):raise
now=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z');pk='OPERATIONAL_SETTINGS#ORDER_EXCEPTION_CASES';table=ddb.Table('staging-PlatformStaff');current=table.get_item(Key={'pk':pk,'sk':'CURRENT'},ConsistentRead=True).get('Item')
values={'sla':{k:{'responseSeconds':a,'escalationSeconds':b}for k,a,b in [('SAFETY',60,300),('CUSTODY',180,600),('COD',300,900),('FINANCIAL',14400,86400),('STANDARD',86400,172800)]},'postDeliveryClaimSeconds':86400,'appealSeconds':259200,'lateSafetyAndCashReviewAllowed':True}
if not current:
 from boto3.dynamodb.types import TypeSerializer
 enc=lambda row:{k:TypeSerializer().serialize(v)for k,v in row.items()}
 row={'pk':pk,'sk':'CURRENT','version':1,'policyVersion':'OECSR_CASES_232_USER_APPROVED_V1','values':values,'updatedAt':now,'updatedBy':'USER_APPROVED_DEPLOYMENT_232','effectiveFor':'NEW_CASES_AND_NEW_DECISIONS'}
 s.client('dynamodb').transact_write_items(TransactItems=[{'Put':{'TableName':'staging-PlatformStaff','Item':enc(row),'ConditionExpression':'attribute_not_exists(pk)'}},{'Put':{'TableName':'staging-PlatformStaff','Item':enc({**row,'sk':'VERSION#'+row['policyVersion']}),'ConditionExpression':'attribute_not_exists(pk)'}}]);current=row
assert int(current['version'])>=1
result={'stack':name,'status':cf.describe_stacks(StackName=name)['Stacks'][0]['StackStatus'],'policyVersion':current['policyVersion'],'policyVersionNumber':int(current['version']),'publishedAt':now,'noFinancialWrites':True,'monitorPolicyBoundariesVerified':True};(p/'provision-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
