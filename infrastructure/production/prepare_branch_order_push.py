"""Package the paired merchant device push registration and order stream consumer."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import REPO, BUCKET, allow, ref, attr, sub, table
from prepare_merchant_profile import build as profile
from prepare_dispatch_worker import build as dispatch
from prepare_order_financial_runtime import dynamodb

NAME='wizz-production-branch-order-push'
SOUND=('OPERATIONAL_SETTINGS#ORDER_RECEPTION',)
DEVICES=('BRANCH_DEVICE#*','BRANCH_PUSH_TOKEN#*')
BRANCHES=('BRANCH#*',)
LIFECYCLE=('BUSINESS_LIFECYCLE#MERCHANT#*','ACCOUNT_LIFECYCLE#MERCHANT#*')
EVENTS=('MERCHANT_BRANCH_ORDER_PUSH#*',)


def build():
    source=profile()
    source['Description']='Production paired merchant device push registration and order notices.'
    source['Parameters']['ArtifactKey']['AllowedPattern']='branch-order-push/register/[a-f0-9]{64}[.]zip'
    source['Parameters'].update({
        'WorkerArtifactKey': {'Type':'String','AllowedPattern':'branch-order-push/worker/[a-f0-9]{64}[.]zip'},
        'WorkerArtifactVersion': {'Type':'String','MinLength':1},
        'OrdersStreamArn': {'Type':'String','AllowedPattern':
                           r'arn:aws:dynamodb:us-east-1:746727375268:table/wizz-production-Orders/stream/[A-Za-z0-9_.:-]+'},
        **{key:value for key,value in dispatch()['Parameters'].items() if key.startswith('FirebaseProduction')},
    })
    r=source['Resources']={key:source['Resources'][key] for key in ('LogGroup','Role','Function','Api','Deployment','Stage')}

    def add(name,kind,**props):
        r[name]={'Type':kind,'Condition':'IsProductionAccount','Properties':props}

    def logs(name):
        return allow(['logs:CreateLogStream','logs:PutLogEvents'],
                     sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/'+name+':*'))

    registration=NAME+'-register'
    r['LogGroup']['Properties']['LogGroupName']='/aws/lambda/'+registration
    r['Role']['Properties']['Policies']=[{'PolicyName':'RegisterBranchPush','PolicyDocument':{'Version':'2012-10-17','Statement':[
        logs(registration),
        *[dynamodb('Merchants',action) for action in ('GetItem','ConditionCheckItem')],
        *[dynamodb('AccountDeletion',action,LIFECYCLE) for action in ('GetItem','ConditionCheckItem')],
        *[dynamodb('MerchantPlatform',action,BRANCHES) for action in ('GetItem','ConditionCheckItem','PutItem')],
        dynamodb('PlatformStaff','GetItem',SOUND),
        dynamodb('PushDeviceTokens','PutItem',DEVICES),
    ]}}]
    frame=r['Function']['Properties']
    frame.update(FunctionName=registration,Timeout=20,Environment={'Variables':{
        'ENVIRONMENT':'production','MERCHANT_STAFF_PERMISSION_MODE':'CENTRAL',
    }})
    r['Api']['Properties']['Name']=NAME
    add('BranchDevice','AWS::ApiGateway::Resource',RestApiId=ref('Api'),ParentId=attr('Api','RootResourceId'),PathPart='branch-device')
    add('Push','AWS::ApiGateway::Resource',RestApiId=ref('Api'),ParentId=ref('BranchDevice'),PathPart='push')
    add('PushPOST','AWS::ApiGateway::Method',RestApiId=ref('Api'),ResourceId=ref('Push'),HttpMethod='POST',
        AuthorizationType='NONE',Integration={'Type':'AWS_PROXY','IntegrationHttpMethod':'POST',
        'Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')})
    add('PushInvoke','AWS::Lambda::Permission',Action='lambda:InvokeFunction',FunctionName=ref('Function'),
        Principal='apigateway.amazonaws.com',SourceAccount=ref('AWS::AccountId'),
        SourceArn=sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/POST/branch-device/push'))
    r['Deployment']['DependsOn']=['PushPOST','PushInvoke']

    worker=NAME+'-worker'
    add('WorkerLog','AWS::Logs::LogGroup',LogGroupName='/aws/lambda/'+worker,RetentionInDays=90)
    r['WorkerLog'].update(DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
    add('FailedEvents','AWS::SQS::Queue',QueueName=NAME+'-failed-events',MessageRetentionPeriod=1209600,SqsManagedSseEnabled=True)
    r['FailedEvents'].update(DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
    mark=dynamodb('WalletNotifications','UpdateItem',EVENTS)
    del mark['Condition']['StringEquals']
    remove=dynamodb('MerchantPlatform','DeleteItem',BRANCHES)
    del remove['Condition']['StringEquals']
    add('WorkerRole','AWS::IAM::Role',AssumeRolePolicyDocument=r['Role']['Properties']['AssumeRolePolicyDocument'],
        Policies=[{'PolicyName':'OrderNoticeWorker','PolicyDocument':{'Version':'2012-10-17','Statement':[
            logs(worker),
            allow(['dynamodb:DescribeStream','dynamodb:GetRecords','dynamodb:GetShardIterator','dynamodb:ListStreams'],ref('OrdersStreamArn')),
            dynamodb('Orders','GetItem',('ORDER#*',)),
            dynamodb('Merchants','GetItem'),
            dynamodb('AccountDeletion','GetItem',LIFECYCLE),
            dynamodb('MerchantPlatform','GetItem',BRANCHES),
            dynamodb('PlatformStaff','GetItem',SOUND),
            dynamodb('PushDeviceTokens','GetItem',DEVICES),
            allow('dynamodb:Query',table('PushDeviceTokens/index/BusinessIdIndex')),
            dynamodb('WalletNotifications','GetItem',EVENTS),
            mark,remove,
            allow('secretsmanager:GetSecretValue',ref('FirebaseProductionSecretArn')),
            allow('sqs:SendMessage',attr('FailedEvents','Arn')),
        ]}}])
    add('Worker','AWS::Lambda::Function',FunctionName=worker,Runtime='nodejs22.x',Handler='index.handler',MemorySize=512,
        Timeout=40,Role=attr('WorkerRole','Arn'),LoggingConfig={'LogGroup':ref('WorkerLog')},
        Code={'S3Bucket':BUCKET,'S3Key':ref('WorkerArtifactKey'),'S3ObjectVersion':ref('WorkerArtifactVersion')},
        Environment={'Variables':{
            'ENVIRONMENT':'production','STAGE':'production',
            'ORDERS_STREAM_ARN':ref('OrdersStreamArn'),'FIREBASE_ADMIN_SA_SECRET_ID':ref('FirebaseProductionSecretArn'),
            'FIREBASE_PRODUCTION_PROJECT_ID':'wizz-business-app',
            'FIREBASE_PRODUCTION_SERVICE_ACCOUNT_EMAIL':ref('FirebaseProductionServiceAccountEmail'),
        }})
    add('OrderSource','AWS::Lambda::EventSourceMapping',FunctionName=ref('Worker'),
        EventSourceArn=ref('OrdersStreamArn'),StartingPosition='LATEST',Enabled=True,BatchSize=5,
        MaximumRetryAttempts=7,MaximumRecordAgeInSeconds=900,FunctionResponseTypes=['ReportBatchItemFailures'],
        DestinationConfig={'OnFailure':{'Destination':attr('FailedEvents','Arn')}},
        FilterCriteria={'Filters':[{'Pattern':json.dumps({'eventName':['INSERT','MODIFY'],
            'dynamodb':{'NewImage':{'PK':{'S':[{'prefix':'ORDER#'}]},'SK':{'S':['META']}}}},separators=(',',':'))}]})
    return source


def package(out,name):
    entry=REPO/'infrastructure/production/branch-order-push'/(name+'-index.cjs')
    code=subprocess.check_output([str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),str(entry),
        '--bundle','--platform=node','--target=node22','--format=cjs','--keep-names','--log-level=error',
        '--external:@aws-sdk/*'],cwd=REPO)
    archive=out/(name+'.zip')
    with ZipFile(archive,'w') as bundle:
        bundle.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),code,compress_type=ZIP_DEFLATED)
    return hashlib.sha256(archive.read_bytes()).hexdigest()


if __name__=='__main__':
    out=Path(sys.argv[1]).resolve()
    out.mkdir(parents=True,exist_ok=True)
    (out/'template.json').write_text(json.dumps(build(),separators=(',',':'))+'\n')
    for name in ['register','worker']:
        print(name,package(out,name))
