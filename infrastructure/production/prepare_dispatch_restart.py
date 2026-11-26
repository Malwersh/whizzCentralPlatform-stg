"""Package the staff restart action and attach it to the current monitoring API."""
import copy
import hashlib
import json
import sys
from pathlib import Path

from prepare_customer_storefront import BUCKET, ROOT, allow, attr, ref, sub
from prepare_order_financial_runtime import dynamodb
from prepare_order_returns import add_resource, method, resource
from prepare_staff_unassignment import MONITOR, bundled, package

NAME = 'wizz-production-dispatch-restart'
ACCOUNT = '746727375268'
REGION = 'us-east-1'


def restart_template():
    source = json.loads((ROOT/'order-financial-runtime.template.json').read_text())
    bindings = source['Resources']['Function']['Properties']['Environment']['Variables']
    env = {key: value for key, value in bindings.items() if isinstance(value,str)}
    config = json.dumps({'accountId':ACCOUNT,'region':REGION,'schemaVersion':1,'scopes':[]},separators=(',',':'))
    env.update(STAGE='production',FINANCIAL_COD_ACCOUNT_ID=ref('AWS::AccountId'),
               FINANCE_GENERAL_RELEASE_MODE='REQUIRED', FINANCE_ROLLOUT_CONFIG=config,
               FINANCE_ROLLOUT_SHA256=hashlib.sha256(config.encode()).hexdigest())
    template = {
        'AWSTemplateFormatVersion':'2010-09-09',
        'Description':'Private staff-controlled restart of an exhausted production dispatch cycle.',
        'Conditions':{'IsProductionAccount':{'Fn::And':[
            {'Fn::Equals':[ref('AWS::AccountId'),ACCOUNT]},
            {'Fn::Equals':[ref('AWS::Region'),REGION]},
        ]}},
        'Parameters':{
            'ArtifactKey':{'Type':'String','AllowedPattern':'dispatch-restart/[a-f0-9]{64}[.]zip'},
            'ArtifactVersion':{'Type':'String','MinLength':1},
        },
        'Resources':{},
    }
    log='/aws/lambda/'+NAME
    add_resource(template,'LogGroup','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':90},
                 DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
    statements = [
        allow(['logs:CreateLogStream','logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')),
        allow('cognito-idp:AdminGetUser',sub(
            'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/'+env['ADMIN_USER_POOL_ID'])),
    ]
    rights = [
        ('Orders',('ORDER#*',),('GetItem','ConditionCheckItem','UpdateItem')),
        ('DispatchJobs',(),('GetItem','ConditionCheckItem','Query','PutItem','UpdateItem')),
        ('WaveOffers',(),('Query','ConditionCheckItem')),
        ('Holds',(),('GetItem','Query','ConditionCheckItem')),
        ('WalletLifecycle',('CDA:*:EVENT','CA:*:EVENT'),('GetItem','ConditionCheckItem')),
        ('Merchants',(),('GetItem','ConditionCheckItem')),
        ('AccountDeletion',('ACCOUNT_LIFECYCLE#MERCHANT#*','BUSINESS_LIFECYCLE#MERCHANT#*'),('GetItem','ConditionCheckItem')),
        ('PlatformStaff',('EMPLOYEE#*','OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS','DISPATCH_REVIEW#*'),
         ('GetItem','ConditionCheckItem')),
        ('PlatformStaff',('DISPATCH_REVIEW#*','AUDIT'),('PutItem',)),
    ]
    statements += [dynamodb(name,action,keys) for name,keys,actions in rights for action in actions]
    add_resource(template,'Role','AWS::IAM::Role',{
        'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{
            'Effect':'Allow','Action':'sts:AssumeRole','Principal':{'Service':'lambda.amazonaws.com'},
        }]},
        'Policies':[{'PolicyName':'ProductionDispatchRestart','PolicyDocument':{
            'Version':'2012-10-17','Statement':statements,
        }}],
    })
    add_resource(template,'RestartFunction','AWS::Lambda::Function',{
        'FunctionName':NAME,'Runtime':'nodejs22.x','Handler':'index.handler',
        'Role':attr('Role','Arn'),'MemorySize':512,'Timeout':23,
        'Code':{'S3Bucket':BUCKET,'S3Key':ref('ArtifactKey'),'S3ObjectVersion':ref('ArtifactVersion')},
        'Environment':{'Variables':env},'LoggingConfig':{'LogGroup':ref('LogGroup')},
    })
    return template


def monitor_template(base):
    template=copy.deepcopy(base)
    resources=template['Resources']
    policies=resources['Role']['Properties']['Policies']
    policies.append({'PolicyName':'InvokeDispatchRestart','PolicyDocument':{'Version':'2012-10-17','Statement':[
        allow('lambda:InvokeFunction',sub('arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:'+NAME)),
    ]}})
    resources['MonitorFunction']['Properties']['Timeout']=27
    resource(template,'Restart','StaffApi',ref('MonitorRoot'),'restart')
    dependencies=[]
    for verb in ('GET','POST'):
        dependencies+=method(template,'Restart'+verb,'StaffApi','Restart',verb,'staff/order-monitoring/restart',
                             function_name=MONITOR,dependency='MonitorFunction')
    stage=resources['Stage']['Properties']
    current=stage['DeploymentId']['Ref']
    assert {'AssignmentGET','AssignmentPOST'}<=set(resources[current]['DependsOn'])
    add_resource(template,'RestartDeployment','AWS::ApiGateway::Deployment',{'RestApiId':ref('StaffApi')},
                 DependsOn=resources[current]['DependsOn']+dependencies)
    stage['DeploymentId']=ref('RestartDeployment')
    return template


if __name__=='__main__':
    out=Path(sys.argv[1]).resolve()
    out.mkdir(parents=True,exist_ok=True)
    print('restart',package({'index.js':bundled('backend/wallet-service/src/productionDispatchRestart.ts')},
                            out/'dispatch-restart.zip'))
    print('monitor',package({'index.js':bundled('infrastructure/production/order-monitoring/index.cjs')},
                            out/'order-monitoring.zip'))
    (out/'dispatch-restart.template.json').write_text(json.dumps(restart_template(),separators=(',',':')))
