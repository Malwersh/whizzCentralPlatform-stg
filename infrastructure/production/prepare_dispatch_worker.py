"""Build the production wave worker with its own scheduler and provider bindings."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import BUCKET, REPO, ROOT, allow, attr, ref, sub, table
from prepare_order_financial_runtime import build as financial_template, dynamodb

NAME = 'wizz-production-dispatch-cycle'
ACCOUNT = '746727375268'
REGION = 'us-east-1'


def build(include_performance=False):
    condition = 'IsProductionAccount'
    resources = {}

    def add(key, kind, properties, **extra):
        resources[key] = {'Type': kind, 'Condition': condition, 'Properties': properties, **extra}

    log = '/aws/lambda/' + NAME
    add('LogGroup','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':90},
        DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
    add('FailedEvents','AWS::SQS::Queue',{
        'QueueName':NAME+'-failed-events','MessageRetentionPeriod':1209600,'SqsManagedSseEnabled':True,
    },DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
    settings = ('OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS','OPERATIONAL_SETTINGS#DELIVERY_PRICING',
                'OPERATIONAL_SETTINGS#ORDER_RECEPTION','DISPATCH_REVIEW#*')
    budget = ('DELIVERY_BUDGET#*','DELIVERY_RESERVATION#*','DELIVERY_USAGE#*')
    rules = {
        'Orders': (('ORDER#*',), ('GetItem','ConditionCheckItem','UpdateItem')),
        'DispatchJobs': ((), ('GetItem','ConditionCheckItem','Query','Scan','PutItem','UpdateItem')),
        'WaveOffers': ((), ('GetItem','ConditionCheckItem','PutItem','UpdateItem')),
        'Drivers': ((), ('GetItem','ConditionCheckItem')),
        'DriverLiveState': ((), ('GetItem','ConditionCheckItem','Scan')),
        'Merchants': ((), ('GetItem','ConditionCheckItem')),
        'AccountDeletion': (('ACCOUNT_LIFECYCLE#DRIVER#*','ACCOUNT_LIFECYCLE#MERCHANT#*','BUSINESS_LIFECYCLE#MERCHANT#*'),
                            ('GetItem','ConditionCheckItem')),
        'Regions': ((), ('GetItem','ConditionCheckItem')),
        'RegionsDerived': ((), ('GetItem','ConditionCheckItem')),
        'RegionNeighbors': ((), ('GetItem','ConditionCheckItem')),
        'PlatformStaff': (settings+budget, ('GetItem','ConditionCheckItem')),
        'Holds': ((), ('GetItem','ConditionCheckItem')),
        'OrderConnections': ((), ('GetItem',)),
        'PushDeviceTokens': ((), ('GetItem',)),
    }
    bindings = json.loads((ROOT/'wallet-identity-bindings.json').read_text())['identities']
    statements = [
        allow(['logs:CreateLogStream','logs:PutLogEvents'],
            sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
        allow('cognito-idp:AdminGetUser',
            sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + bindings['driver']['poolId'])),
        *[dynamodb(name,action,keys) for name,(keys,actions) in rules.items() for action in actions],
        allow('dynamodb:Query',table('PushDeviceTokens/index/SubjectIdIndex')),
        allow('execute-api:ManageConnections',
            sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:9plheg8f1h/production/POST/@connections/*')),
        allow('secretsmanager:GetSecretValue',[ref('MapboxProductionSecretArn'),ref('FirebaseProductionSecretArn')]),
        allow('sqs:SendMessage',attr('FailedEvents','Arn')),
    ]
    if include_performance:
        statements.append(dynamodb('DriverPerformanceSnapshots','GetItem',('DRIVER#*','CONTROL')))
    add('Role','AWS::IAM::Role',{
        'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[
            {'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},
        'Policies':[{'PolicyName':'ProductionDispatchCycle','PolicyDocument':{'Version':'2012-10-17','Statement':statements}}],
    })

    base = financial_template()['Resources']['Function']['Properties']['Environment']['Variables']
    env = {key:value for key,value in base.items() if isinstance(value,str)}
    config = '{"accountId":"746727375268","region":"us-east-1","schemaVersion":1,"scopes":[]}'
    env.update({
        'ENVIRONMENT':'production','STAGE':'production','FINANCIAL_COD_ACCOUNT_ID':ACCOUNT,
        'FINANCE_GENERAL_RELEASE_MODE':'REQUIRED','FINANCE_ROLLOUT_CONFIG':config,
        'FINANCE_ROLLOUT_SHA256':hashlib.sha256(config.encode()).hexdigest(),
        'DISPATCH_FINANCIAL_HOST_MODE':'REQUIRED','FINANCIAL_PUSH_VALIDATION_MODE':'REQUIRED',
        'PINNED_FINANCIAL_PUSH_MODE':'REQUIRED','PINNED_DISPATCH_ACCOUNT_ID':ACCOUNT,
        'DRIVER_WORK_REGION_ENFORCE':'true','DRIVER_VEHICLE_REGISTRY_ENFORCE':'true',
        'PUSH_TOKENS_TABLE':'wizz-production-PushDeviceTokens',
        'REALTIME_MANAGEMENT_URL':'https://9plheg8f1h.execute-api.us-east-1.amazonaws.com/production',
        'FINANCIAL_ROUTING_SECRET_ARN':ref('MapboxProductionSecretArn'),
        'FIREBASE_ADMIN_SA_SECRET_ID':ref('FirebaseProductionSecretArn'),
        'FIREBASE_PRODUCTION_PROJECT_ID':'wizz-business-app',
        'FIREBASE_PRODUCTION_SERVICE_ACCOUNT_EMAIL':ref('FirebaseProductionServiceAccountEmail'),
        'PRODUCTION_ORDERS_STREAM_ARN':ref('OrdersStreamArn'),
        'PRODUCTION_DISPATCH_RULE_ARN':sub('arn:${AWS::Partition}:events:${AWS::Region}:${AWS::AccountId}:rule/'+NAME),
    })
    if include_performance:
        env.update(DRIVER_PERFORMANCE_TABLE='wizz-production-DriverPerformanceSnapshots',
                   DISPATCH_DRIVER_PERFORMANCE_MODE='ENFORCE')
    add('Worker','AWS::Lambda::Function',{
        'FunctionName':NAME,'Handler':'index.handler','Runtime':'nodejs22.x','MemorySize':1024,'Timeout':55,
        'Role':attr('Role','Arn'),'DeadLetterConfig':{'TargetArn':attr('FailedEvents','Arn')},
        'Code':{'S3Bucket':BUCKET,'S3Key':ref('ArtifactKey'),'S3ObjectVersion':ref('ArtifactVersion')},
        'Environment':{'Variables':env},'LoggingConfig':{'LogGroup':ref('LogGroup')},
    })
    add('Retry','AWS::Lambda::EventInvokeConfig',{
        'FunctionName':ref('Worker'),'Qualifier':'$LATEST','MaximumRetryAttempts':2,'MaximumEventAgeInSeconds':900,
    })
    add('CycleTick','AWS::Events::Rule',{
        'Name':NAME,'ScheduleExpression':'rate(1 minute)','State':'ENABLED',
        'Targets':[{'Id':'DispatchCycle','Arn':attr('Worker','Arn')}],
    })
    add('TickInvoke','AWS::Lambda::Permission',{
        'Action':'lambda:InvokeFunction','FunctionName':ref('Worker'),'Principal':'events.amazonaws.com',
        'SourceAccount':ref('AWS::AccountId'),'SourceArn':attr('CycleTick','Arn'),
    })
    return {
        'AWSTemplateFormatVersion':'2010-09-09',
        'Description':'Production financial dispatch wave execution and scheduled recovery.',
        'Conditions': {condition:{'Fn::And':[
            {'Fn::Equals':[ref('AWS::AccountId'),ACCOUNT]}, {'Fn::Equals':[ref('AWS::Region'),REGION]}]}},
        'Parameters': {
            'ArtifactKey':{'Type':'String','AllowedPattern':'dispatch-worker/[a-f0-9]{64}[.]zip'},
            'ArtifactVersion':{'Type':'String','MinLength':1},
            'OrdersStreamArn':{'Type':'String','AllowedPattern':
                r'arn:aws:dynamodb:us-east-1:746727375268:table/wizz-production-Orders/stream/[A-Za-z0-9_.:-]+'},
            'MapboxProductionSecretArn':{'Type':'String','AllowedPattern':
                r'arn:aws:secretsmanager:us-east-1:746727375268:secret:production/finance/mapbox/server-routing-[A-Za-z0-9]{6}'},
            'FirebaseProductionSecretArn':{'Type':'String','AllowedPattern':
                r'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/firebase/admin-service-account-[A-Za-z0-9]{6}'},
            'FirebaseProductionServiceAccountEmail':{'Type':'String','AllowedPattern':
                r'[a-z][a-z0-9-]{4,28}[a-z0-9]@wizz-business-app[.]iam[.]gserviceaccount[.]com'},
        },
        'Resources':resources,
        'Outputs':{'DispatchWorkerArn':{'Condition':condition,'Value':attr('Worker','Arn')}},
    }


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True,exist_ok=True)
    bundle = subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),
        'backend/wallet-service/src/productionDispatchRuntime.ts','--bundle','--platform=node',
        '--target=node22','--format=cjs','--log-level=error','--external:@aws-sdk/*',
    ],cwd=REPO)
    artifact = out/'dispatch-worker.zip'
    with ZipFile(artifact,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),bundle,compress_type=ZIP_DEFLATED)
    (out/'dispatch-worker.template.json').write_text(json.dumps(build(include_performance=True),indent=2)+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
