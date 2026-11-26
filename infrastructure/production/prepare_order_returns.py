"""Package the isolated production return service and attach its reviewed callers."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import ROOT, REPO, BUCKET, allow, attr, ref, sub, table
from prepare_order_financial_runtime import build as financial_template, dynamodb

NAME = 'wizz-production-order-returns'
DRIVER_API = 'kq49g7b6wa'
MERCHANT_API = '5ijjfzcxb8'
STAFF_ROUTES = {
    'Queue': ('staff/order-exceptions', 'GET'),
    'Detail': ('staff/order-exceptions/detail', 'GET'),
    'Custodians': ('staff/order-exceptions/custodians', 'GET'),
    'Actions': ('staff/order-exceptions/actions', 'POST'),
}


def add_resource(template, key, kind, properties, **attributes):
    assert key not in template['Resources'], key
    template['Resources'][key] = {
        'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': properties, **attributes,
    }


def resource(template, key, api, parent, segment):
    add_resource(template, key, 'AWS::ApiGateway::Resource', {
        'RestApiId': ref(api), 'ParentId': parent, 'PathPart': segment,
    })


def method(template, key, api, resource_key, verb, path, *, function_name=NAME, dependency='ReturnFunction'):
    function = 'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:' + function_name
    add_resource(template, key, 'AWS::ApiGateway::Method', {
        'RestApiId': ref(api), 'ResourceId': ref(resource_key), 'HttpMethod': verb, 'AuthorizationType': 'NONE',
        'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST',
            'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
                       + function + '/invocations')},
    })
    invoke = key + 'Invoke'
    add_resource(template, invoke, 'AWS::Lambda::Permission', {
        'FunctionName': sub(function), 'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com',
        'SourceAccount': ref('AWS::AccountId'),
        'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:'
                         '${' + api + '}/production/' + verb + '/' + path),
    }, **({'DependsOn': dependency} if dependency in template['Resources'] else {}))
    return [key, invoke]


def build():
    baseline = financial_template()
    template = {key: baseline[key] for key in ('AWSTemplateFormatVersion', 'Rules')}
    template['Description'] = 'Production full-cash delivery attempts, returns and return-case review.'
    template['Conditions'] = {'IsProductionAccount': baseline['Conditions']['IsProductionAccount']}
    template['Parameters'] = {
        'ExpectedAccountId': baseline['Parameters']['ExpectedAccountId'],
        'ArtifactKey': {'Type': 'String', 'AllowedPattern': r'order-returns/[a-f0-9]{64}[.]zip'},
        'ArtifactVersion': {'Type': 'String', 'MinLength': 1},
        'MapboxRoutingSecretArn': {'Type': 'String', 'AllowedPattern':
            r'arn:aws:secretsmanager:us-east-1:746727375268:secret:[A-Za-z0-9/_+=.@-]+-[A-Za-z0-9]{6}'},
    }
    template['Resources'] = {}
    log = '/aws/lambda/' + NAME
    add_resource(template, 'ReturnLog', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
                 DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    env = {key:value for key,value in baseline['Resources']['Function']['Properties']['Environment']['Variables'].items()
           if isinstance(value,str)}
    rollout = {'schemaVersion':1,'accountId':'746727375268','region':'us-east-1','scopes':[]}
    encoded = json.dumps(rollout,separators=(',',':'),sort_keys=True)
    env.update(RETURN_DRIVER_API_ID=DRIVER_API,RETURN_MERCHANT_API_ID=MERCHANT_API,
               RETURN_STAFF_API_ID=ref('StaffApi'),FINANCIAL_ROUTING_SECRET_ARN=ref('MapboxRoutingSecretArn'),
               FINANCE_GENERAL_RELEASE_MODE='REQUIRED',FINANCE_ROLLOUT_CONFIG=encoded,
               RETURN_TASK_NOTIFICATIONS_MODE='REQUIRED',EXCEPTION_FINANCIAL_NOTIFICATIONS_MODE='REQUIRED',
               WALLET_NOTIFICATIONS_TABLE='wizz-production-WalletNotifications',
               FINANCE_ROLLOUT_SHA256=hashlib.sha256(encoded.encode()).hexdigest())
    operational = ('OPERATIONAL_SETTINGS#ORDER_EXCEPTIONS','OPERATIONAL_SETTINGS#ORDER_EXCEPTION_CASES',
                   'OPERATIONAL_SETTINGS#RETURN_OPERATIONS','EMPLOYEE#*')
    merchant = ('RETURN_ACCEPTANCE#*','MERCHANT_PAYOUT_PAID#MPO:*','MERCHANT_ACCRUAL#*')
    wallets = ('WALLET#DRIVER#*','WALLET#MERCHANT#*')
    reads = [
        allow(['logs:CreateLogStream','logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
        allow('secretsmanager:GetSecretValue',ref('MapboxRoutingSecretArn')),
        allow('cognito-idp:AdminGetUser',[sub(
            'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + env[role+'_USER_POOL_ID'])
            for role in ('DRIVER','MERCHANT','ADMIN')]),
        allow('dynamodb:Query',[table('Holds'),table('Orders/index/GSI_OrderNumber')]),
        allow('dynamodb:Query',table('WalletLifecycle/index/ByDue'),{
            'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['ORDER_EXCEPTIONS_OPEN']},
            'Null':{'dynamodb:LeadingKeys':'false'},
        }),
        allow('dynamodb:Scan',table('PlatformStaff')),
        *[dynamodb(name,'GetItem',keys) for name,keys in [
            ('Orders',('ORDER#*',)),('Holds',()),('Drivers',()),('Merchants',()),('DispatchJobs',()),
            ('DriverLiveState',()),('WaveOffers',()),('Wallets',wallets),('MerchantPlatform',merchant),
            ('OfferJourney',('BENEFIT_ORDER#*','USER#*')),
            ('PlatformStaff',operational+('DELIVERY_BUDGET#*','DELIVERY_USAGE#*','DELIVERY_RESERVATION#*')),
            ('WalletLifecycle',('FCH:*','FH:*','EXCEPTION_CASE#*')),
        ]],
    ]
    conditions = [
        dynamodb(name,'ConditionCheckItem',keys) for name,keys in [
            ('Orders',('ORDER#*',)),('Holds',()),('Drivers',()),('Merchants',()),('DispatchJobs',()),
            ('DriverLiveState',()),('WaveOffers',()),('Wallets',wallets),('MerchantPlatform',merchant),
            ('OfferJourney',('BENEFIT_ORDER#*','USER#*')),
            ('PlatformStaff',operational+('DELIVERY_BUDGET#*','DELIVERY_USAGE#*','DELIVERY_RESERVATION#*')),
            ('WalletLifecycle',('FCH:*','FH:*','EXCEPTION_CASE#*')),
            ('AccountDeletion',('ACCOUNT_LIFECYCLE#DRIVER#*','ACCOUNT_LIFECYCLE#MERCHANT#*','BUSINESS_LIFECYCLE#MERCHANT#*')),
        ]
    ]
    writes = [
        dynamodb(name,operation,keys) for name,operation,keys in [
            ('Orders','UpdateItem',('ORDER#*',)),('Holds','PutItem',()),('Holds','UpdateItem',()),
            ('DispatchJobs','UpdateItem',()),('DriverLiveState','UpdateItem',()),
            ('Wallets','UpdateItem',wallets),('LedgerEntries','PutItem',wallets),
            ('MerchantPlatform','PutItem',('RETURN_ACCEPTANCE#*','MERCHANT_ACCRUAL#*')),
            ('AuditLog','PutItem',('date#*',)),
            ('PlatformStaff','PutItem',('DELIVERY_BUDGET#*','DELIVERY_USAGE#*','DELIVERY_RESERVATION#*',
                                       'OPERATIONAL_SETTINGS#ORDER_EXCEPTIONS','OPERATIONAL_SETTINGS#RETURN_OPERATIONS','AUDIT')),
            ('OfferJourney','PutItem',('BENEFIT_ORDER#*','USER#*')),
            ('WalletLifecycle','UpdateItem',('FCH:*','FH:*')),
            ('WalletLifecycle','PutItem',('EXCEPTION_CASE#*',)),
            ('WalletNotifications','PutItem',('RETURN_TASK_NOTICE#*','EXCEPTION_FINANCIAL_NOTICE#*')),
        ]
    ]
    for key, statements in [('ReturnReads',reads),('ReturnConditions',conditions),('ReturnWrites',writes)]:
        add_resource(template,key,'AWS::IAM::ManagedPolicy',{
            'PolicyDocument':{'Version':'2012-10-17','Statement':statements},
        })
    add_resource(template,'ReturnRole','AWS::IAM::Role',{
        'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[
            {'Effect':'Allow','Action':'sts:AssumeRole','Principal':{'Service':'lambda.amazonaws.com'}},
        ]},
        'ManagedPolicyArns': [ref(key) for key in ('ReturnReads','ReturnConditions','ReturnWrites')],
    })
    add_resource(template,'ReturnFunction','AWS::Lambda::Function',{
        'FunctionName':NAME,'Runtime':'nodejs22.x','Handler':'index.handler','MemorySize':512,'Timeout':19,
        'Role':attr('ReturnRole','Arn'),'LoggingConfig':{'LogGroup':ref('ReturnLog')},
        'Code':{'S3Bucket':BUCKET,'S3Key':ref('ArtifactKey'),'S3ObjectVersion':ref('ArtifactVersion')},
        'Environment':{'Variables':env},
    })
    add_resource(template,'ReturnSlaTick','AWS::Events::Rule',{
        'Name':NAME+'-sla','ScheduleExpression':'rate(1 minute)','State':'ENABLED',
        'Targets':[{'Id':'ReturnSla','Arn':attr('ReturnFunction','Arn')}],
    })
    add_resource(template,'ReturnSlaInvoke','AWS::Lambda::Permission',{
        'FunctionName':ref('ReturnFunction'),'Action':'lambda:InvokeFunction','Principal':'events.amazonaws.com',
        'SourceAccount':ref('AWS::AccountId'),'SourceArn':attr('ReturnSlaTick','Arn'),
    })
    add_resource(template,'StaffApi','AWS::ApiGateway::RestApi',{
        'Name':NAME,'EndpointConfiguration':{'Types':['REGIONAL']},
    })
    resource(template,'StaffRoot','StaffApi',attr('StaffApi','RootResourceId'),'staff')
    resource(template,'StaffQueue','StaffApi',ref('StaffRoot'),'order-exceptions')
    dependencies=[]
    for key,(path,verb) in STAFF_ROUTES.items():
        if key!='Queue': resource(template,'Staff'+key,'StaffApi',ref('StaffQueue'),path.rsplit('/',1)[1])
        dependencies.extend(method(template,'Staff'+key+'Method','StaffApi','Staff'+key,verb,path))
    resource(template,'SettingsRoot','StaffApi',ref('StaffRoot'),'settings')
    for key,path in [('ReturnPolicy','return-operations'),('AttemptPolicy','order-exceptions')]:
        resource(template,key,'StaffApi',ref('SettingsRoot'),path)
        resource(template,key+'Request','StaffApi',ref(key),'request')
        dependencies.extend(method(template,key+'Get','StaffApi',key,'GET','staff/settings/'+path))
        dependencies.extend(method(template,key+'Save','StaffApi',key+'Request','POST','staff/settings/'+path+'/request'))
    add_resource(template,'StaffDeployment','AWS::ApiGateway::Deployment',{'RestApiId':ref('StaffApi')},DependsOn=dependencies)
    add_resource(template,'StaffStage','AWS::ApiGateway::Stage',{
        'StageName':'production','RestApiId':ref('StaffApi'),'DeploymentId':ref('StaffDeployment'),
        'MethodSettings':[{'ResourcePath':'/*','HttpMethod':'*','ThrottlingBurstLimit':18,
                           'ThrottlingRateLimit':8,'DataTraceEnabled':False}],
    })
    template['Outputs']={'StaffUrl':{'Condition':'IsProductionAccount',
        'Value':sub('https://${StaffApi}.execute-api.${AWS::Region}.amazonaws.com/production')}}
    return template


def attach_gateway(template, audience):
    dependencies = []
    if audience=='driver':
        for name,path,verbs in [
            ('DeliveryAttempt','delivery-attempt',('GET','POST')),('ReturnRequest','request-return',('POST',)),
            ('ReturnArrival','arrive-return',('POST',)),('ReturnObstacle','report-return-obstacle',('POST',)),
            ('ReturnCase','return-case',('POST',)),
        ]:
            resource(template,name+'Resource','Api',ref('DriverOrderResource'),path)
            for verb in verbs:
                dependencies.extend(method(template,name+verb,'Api',name+'Resource',verb,'driver/orders/*/'+path))
        resource(template,'DeliveryContactResource','Api',ref('DeliveryAttemptResource'),'contact')
        dependencies.extend(method(template,'DeliveryContactPost','Api','DeliveryContactResource','POST',
                                   'driver/orders/*/delivery-attempt/contact'))
    elif audience=='merchant':
        resource(template,'MerchantReturnResource','Api',ref('MerchantRoot'),'order-returns')
        for verb in ('GET','POST'):
            dependencies.extend(method(template,'MerchantReturn'+verb,'Api','MerchantReturnResource',verb,'auth/order-returns'))
    else:
        raise ValueError(audience)
    resources=template['Resources']
    stage=resources['Stage']['Properties']
    previous=stage['DeploymentId']['Ref']
    deployment=audience.title()+'ReturnsDeployment'
    add_resource(template,deployment,'AWS::ApiGateway::Deployment',{'RestApiId':ref('Api')},
                 DependsOn=resources[previous]['DependsOn']+dependencies)
    stage['DeploymentId']=ref(deployment)
    return template


def package(output):
    source=subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),'infrastructure/production/order-returns/index.cjs',
        '--bundle','--platform=node','--target=node22','--format=cjs','--keep-names','--external:@aws-sdk/*',
    ],cwd=REPO)
    with ZipFile(output,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),source,compress_type=ZIP_DEFLATED)
    return hashlib.sha256(output.read_bytes()).hexdigest()


if __name__=='__main__':
    out=Path(sys.argv[1])
    out.mkdir(parents=True,exist_ok=True)
    (out/'order-returns.template.json').write_text(json.dumps(build(),separators=(',',':'))+'\n')
    print(package(out/'order-returns.zip'))
