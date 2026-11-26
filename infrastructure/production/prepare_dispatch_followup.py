"""Production bindings for the indexed dispatch follow-up inbox and scheduled observer."""
import copy
import json
import sys
from pathlib import Path

from prepare_customer_storefront import BUCKET, allow, attr, ref, sub, table
from prepare_dispatch_restart import restart_template, NAME as RESTART
from prepare_order_financial_runtime import dynamodb
from prepare_order_returns import add_resource, method, resource
from prepare_staff_unassignment import MONITOR, bundled, package

NAME='wizz-production-dispatch-followup'
RULE=NAME
POLICY_KEY='OPERATIONAL_SETTINGS#DISPATCH_FOLLOWUP'
INBOX='DISPATCH_FOLLOWUP_INBOX#OPEN'
CURSOR='CONTROL#DISPATCH_FOLLOWUP_HOST'


def followup_template():
    source=restart_template()
    template={key:copy.deepcopy(source[key]) for key in ('AWSTemplateFormatVersion','Conditions','Parameters')}
    template['Description']='Indexed operational follow-up for exhausted production dispatch searches.'
    template['Parameters']['ArtifactKey']['AllowedPattern']='dispatch-followup/[a-f0-9]{64}[.]zip'
    template['Resources']={}
    log='/aws/lambda/'+NAME
    add_resource(template,'LogGroup','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':90},
                 DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
    env=source['Resources']['RestartFunction']['Properties']['Environment']['Variables']
    rights=[
        ('Orders',('ORDER#*',),('GetItem','ConditionCheckItem')),
        ('DispatchJobs',(),('GetItem','Query','ConditionCheckItem')),
        ('Merchants',(),('GetItem','ConditionCheckItem')),
        ('Holds',(),('GetItem','ConditionCheckItem')),
        ('AccountDeletion',('ORDER_LIFECYCLE#*','BUSINESS_LIFECYCLE#MERCHANT#*','ACCOUNT_LIFECYCLE#MERCHANT#*'),
         ('GetItem','ConditionCheckItem')),
        ('PlatformStaff',('EMPLOYEE#*',POLICY_KEY,INBOX,CURSOR,'DISPATCH_REVIEW#*'),('GetItem','ConditionCheckItem')),
        ('PlatformStaff',(INBOX,),('Query','DeleteItem')),
        ('PlatformStaff',(POLICY_KEY,INBOX,CURSOR,'DISPATCH_REVIEW#*','AUDIT'),('PutItem',)),
    ]
    statements=[
        allow(['logs:CreateLogStream','logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')),
        allow('cognito-idp:AdminGetUser',
              sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/'+env['ADMIN_USER_POOL_ID'])),
        allow('dynamodb:Query',table('DispatchJobs/index/DispatchReviewStatus340')),
        *[dynamodb(name,action,keys) for name,keys,actions in rights for action in actions],
    ]
    add_resource(template,'Role','AWS::IAM::Role',{
        'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[
            {'Effect':'Allow','Action':'sts:AssumeRole','Principal':{'Service':'lambda.amazonaws.com'}},
        ]},
        'Policies':[{'PolicyName':'DispatchFollowupOperations','PolicyDocument':{'Version':'2012-10-17','Statement':statements}}],
    })
    properties=copy.deepcopy(source['Resources']['RestartFunction']['Properties'])
    properties.update(FunctionName=NAME,Timeout=55,MemorySize=512)
    add_resource(template,'FollowupFunction','AWS::Lambda::Function',properties)
    add_resource(template,'Schedule','AWS::Events::Rule',{
        'Name':RULE,'ScheduleExpression':'rate(1 minute)','State':'ENABLED',
        'Targets':[{'Id':'DispatchFollowup','Arn':attr('FollowupFunction','Arn')}],
    })
    add_resource(template,'SchedulePermission','AWS::Lambda::Permission',{
        'Action':'lambda:InvokeFunction','FunctionName':ref('FollowupFunction'),'Principal':'events.amazonaws.com',
        'SourceAccount':ref('AWS::AccountId'),'SourceArn':attr('Schedule','Arn'),
    })
    return template


def restart_followup_template(base):
    template=copy.deepcopy(base)
    policies=template['Resources']['Role']['Properties']['Policies']
    policies.append({'PolicyName':'SeedDispatchFollowup','PolicyDocument':{'Version':'2012-10-17','Statement':[
        dynamodb('PlatformStaff','GetItem',(POLICY_KEY,)),
        dynamodb('PlatformStaff','ConditionCheckItem',(POLICY_KEY,)),
        dynamodb('PlatformStaff','PutItem',(INBOX,)),
    ]}})
    return template


def monitor_template(base):
    template=copy.deepcopy(base)
    resources=template['Resources']
    policies=resources['Role']['Properties']['Policies']
    policies.append({'PolicyName':'DispatchFollowupLinks','PolicyDocument':{'Version':'2012-10-17','Statement':[
        allow('lambda:InvokeFunction',sub('arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:'+NAME)),
        dynamodb('Merchants','GetItem'),
    ]}})
    resource(template,'Followup','StaffApi',ref('MonitorRoot'),'followup')
    resource(template,'FollowupPolicy','StaffApi',ref('Followup'),'policy')
    dependencies=[]
    for logical,path in [('Followup','followup'),('FollowupPolicy','followup/policy')]:
        for verb in ('GET','POST'):
            dependencies+=method(template,logical+verb,'StaffApi',logical,verb,'staff/order-monitoring/'+path,
                                 function_name=MONITOR,dependency='MonitorFunction')
    stage=resources['Stage']['Properties']
    current=stage['DeploymentId']['Ref']
    assert {'RestartGET','RestartPOST'}<=set(resources[current]['DependsOn'])
    add_resource(template,'FollowupDeployment','AWS::ApiGateway::Deployment',{'RestApiId':ref('StaffApi')},
                 DependsOn=resources[current]['DependsOn']+dependencies)
    stage['DeploymentId']=ref('FollowupDeployment')
    return template


if __name__=='__main__':
    out=Path(sys.argv[1]).resolve()
    out.mkdir(parents=True,exist_ok=True)
    for filename,entry in [
        ('dispatch-followup','backend/wallet-service/src/productionDispatchFollowup.ts'),
        ('dispatch-restart','backend/wallet-service/src/productionDispatchRestart.ts'),
        ('order-monitoring','infrastructure/production/order-monitoring/index.cjs'),
    ]:
        print(filename,package({'index.js':bundled(entry)},out/(filename+'.zip')))
    (out/'dispatch-followup.template.json').write_text(json.dumps(followup_template(),separators=(',',':')))
