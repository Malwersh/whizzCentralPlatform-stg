"""Package production cash review with separate staff, customer and driver routes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import BUCKET, REPO, allow, attr, ref, sub, table
from prepare_order_returns import add_resource, resource, method, DRIVER_API, MERCHANT_API
from prepare_order_financial_runtime import build as financial_template, dynamodb

NAME = 'wizz-production-customer-cash-review'
STAFF_PREFIX = 'staff/cash-reviews'


def build():
    base = financial_template()
    output = {key: base[key] for key in ('AWSTemplateFormatVersion','Rules')}
    output['Description'] = 'Isolated production cash dispute and refund review.'
    output['Conditions'] = {'IsProductionAccount':base['Conditions']['IsProductionAccount']}
    output['Parameters'] = {
        'ExpectedAccountId':base['Parameters']['ExpectedAccountId'],
        'ArtifactKey':{'Type':'String','AllowedPattern':r'customer-cash-review/[a-f0-9]{64}[.]zip'},
        'ArtifactVersion':{'Type':'String','MinLength':1},
    }
    output['Resources'] = {}
    log = '/aws/lambda/' + NAME
    add_resource(output,'CashLog','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':90},
                 DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
    env = {key:value for key,value in base['Resources']['Function']['Properties']['Environment']['Variables'].items()
           if isinstance(value,str)}
    cohort = '{"accountId":"746727375268","region":"us-east-1","schemaVersion":1,"scopes":[]}'
    env.update(ENVIRONMENT='production',STAGE='production',FINANCE_GENERAL_RELEASE_MODE='REQUIRED',
               FINANCE_ROLLOUT_CONFIG=cohort,FINANCE_ROLLOUT_SHA256=hashlib.sha256(cohort.encode()).hexdigest(),
               CASH_DRIVER_API_ID=DRIVER_API,CASH_CUSTOMER_API_ID=MERCHANT_API,CASH_STAFF_API_ID=ref('StaffApi'))
    wallets = ('WALLET#DRIVER#*','WALLET#MERCHANT#*')
    budget = ('DELIVERY_BUDGET#*','DELIVERY_USAGE#*','DELIVERY_RESERVATION#*')
    platform = ('FULL_CASH_JOURNAL#*','MERCHANT_ACCRUAL#*','MERCHANT_CASHBOX#*')
    scoped = {
        'Orders':('ORDER#*',),'PlatformStaff':('OPERATIONAL_SETTINGS#ORDER_EXCEPTION_CASES','EMPLOYEE#*',*budget),
        'Holds':(),'Wallets':wallets,'LedgerEntries':wallets,'AuditLog':('date#*',),'Drivers':(),
        'DispatchJobs':(),'DriverLiveState':(),'WaveOffers':(),'Merchants':(),
        'AccountDeletion':('ACCOUNT_LIFECYCLE#CUSTOMER#*','ACCOUNT_LIFECYCLE#DRIVER#*',
                           'ACCOUNT_LIFECYCLE#MERCHANT#*','BUSINESS_LIFECYCLE#MERCHANT#*'),
        'MerchantPlatform':platform,'WalletLifecycle':('EXCEPTION_CASE#*','FCH:*','FH:*'),
        'OfferJourney':('BENEFIT_ORDER#*','USER#*'),
    }
    writes = {
        'Orders':('UpdateItem',),'Holds':('PutItem','UpdateItem'),'LedgerEntries':('PutItem',),
        'Wallets':('UpdateItem',),'DispatchJobs':('UpdateItem',),'DriverLiveState':('UpdateItem',),
        'AuditLog':('PutItem',),'MerchantPlatform':('PutItem',),'OfferJourney':('PutItem',),
    }
    read_grants = [
        allow(['logs:CreateLogStream','logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')),
        allow('cognito-idp:AdminGetUser',[sub(
            'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/'+env[role+'_USER_POOL_ID'])
            for role in ('DRIVER','CUSTOMER','ADMIN')]),
        allow('dynamodb:Query',[table('Holds'),table('Orders/index/GSI_OrderNumber')]),
        allow('dynamodb:Query',table('WalletLifecycle/index/ByDue'),{
            'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['ORDER_EXCEPTIONS_OPEN']},
            'Null':{'dynamodb:LeadingKeys':'false'},
        }),
        *[dynamodb(name,'GetItem',keys) for name,keys in scoped.items() if name not in ('AuditLog','LedgerEntries')],
    ]
    condition_grants = [dynamodb(name,'ConditionCheckItem',keys) for name,keys in scoped.items()
                        if name not in ('AuditLog','LedgerEntries')]
    write_grants = [dynamodb(name,verb,scoped[name]) for name,verbs in writes.items() for verb in verbs]
    write_grants.extend([
        dynamodb('WalletLifecycle','PutItem',('EXCEPTION_CASE#*','FCS:*:EVENT')),
        dynamodb('WalletLifecycle','UpdateItem',('FCH:*',)),
        dynamodb('Wallets','PutItem',('WALLET#MERCHANT#*',)),
        dynamodb('PlatformStaff','PutItem',budget),
    ])
    for label,grants in [('Read',read_grants),('Condition',condition_grants),('Write',write_grants)]:
        add_resource(output,'Cash'+label,'AWS::IAM::ManagedPolicy',
                     {'PolicyDocument':{'Version':'2012-10-17','Statement':grants}})
    role = {'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[
        {'Effect':'Allow','Action':'sts:AssumeRole','Principal':{'Service':'lambda.amazonaws.com'}},
    ]},'ManagedPolicyArns':[ref('Cash'+label) for label in ('Read','Condition','Write')]}
    add_resource(output,'CashRole','AWS::IAM::Role',role)
    add_resource(output,'CashFunction','AWS::Lambda::Function',{
        'FunctionName':NAME,'Handler':'index.handler','Runtime':'nodejs22.x','Timeout':24,'MemorySize':512,
        'Role':attr('CashRole','Arn'),'LoggingConfig':{'LogGroup':ref('CashLog')},
        'Code':{'S3Bucket':BUCKET,'S3Key':ref('ArtifactKey'),'S3ObjectVersion':ref('ArtifactVersion')},
        'Environment':{'Variables':env},
    })
    add_resource(output,'CashSlaTick','AWS::Events::Rule',{
        'Name':NAME+'-sla','ScheduleExpression':'rate(1 minute)','State':'ENABLED',
        'Targets':[{'Id':'CashSla','Arn':attr('CashFunction','Arn')}],
    })
    add_resource(output,'CashSlaInvoke','AWS::Lambda::Permission',{
        'FunctionName':ref('CashFunction'),'Action':'lambda:InvokeFunction','Principal':'events.amazonaws.com',
        'SourceAccount':ref('AWS::AccountId'),'SourceArn':attr('CashSlaTick','Arn'),
    })
    add_resource(output,'StaffApi','AWS::ApiGateway::RestApi',{'Name':NAME,'EndpointConfiguration':{'Types':['REGIONAL']}})
    resource(output,'StaffRoot','StaffApi',attr('StaffApi','RootResourceId'),'staff')
    resource(output,'CashReviews','StaffApi',ref('StaffRoot'),'cash-reviews')
    dependencies = []
    for label,segment,verb in [('Queue',None,'GET'),('Detail','detail','GET'),('Actions','actions','POST')]:
        target = 'CashReviews' if not segment else 'CashReviews'+label
        if segment:
            resource(output,target,'StaffApi',ref('CashReviews'),segment)
        path = STAFF_PREFIX+('/'+segment if segment else '')
        dependencies += method(output,'Staff'+label+'Method','StaffApi',target,verb,path,
                               function_name=NAME,dependency='CashFunction')
    add_resource(output,'StaffDeployment','AWS::ApiGateway::Deployment',{'RestApiId':ref('StaffApi')},DependsOn=dependencies)
    add_resource(output,'StaffStage','AWS::ApiGateway::Stage',{
        'StageName':'production','RestApiId':ref('StaffApi'),'DeploymentId':ref('StaffDeployment'),
        'MethodSettings':[{'ResourcePath':'/*','HttpMethod':'*','ThrottlingBurstLimit':18,
                           'ThrottlingRateLimit':8,'DataTraceEnabled':False}],
    })
    output['Outputs']={'StaffUrl':{'Condition':'IsProductionAccount',
        'Value':sub('https://${StaffApi}.execute-api.${AWS::Region}.amazonaws.com/production')}}
    return output


def attach_gateway(template,audience):
    driver = audience=='driver'
    assert audience in ('driver','customer')
    parent = 'DriverOrderResource' if driver else 'CustomerRoot'
    path = 'driver/orders/*/cash-review' if driver else 'order/cash-review'
    resource(template,'CashReviewResource','Api',ref(parent),'cash-review')
    methods = ('POST',) if driver else ('POST','OPTIONS')
    dependencies = []
    for verb in methods:
        dependencies += method(template,'CashReview'+verb,'Api','CashReviewResource',verb,path,
                               function_name=NAME,dependency='CashFunction')
    stage=template['Resources']['Stage']['Properties']
    previous=stage['DeploymentId']['Ref']
    add_resource(template,'CashReviewDeployment','AWS::ApiGateway::Deployment',{'RestApiId':ref('Api')},
                 DependsOn=template['Resources'][previous]['DependsOn']+dependencies)
    stage['DeploymentId']=ref('CashReviewDeployment')
    return template


def package(output):
    source = subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),'infrastructure/production/customer-cash/index.cjs',
        '--bundle','--platform=node','--target=node22','--format=cjs','--keep-names','--external:@aws-sdk/*',
    ],cwd=REPO)
    with ZipFile(output,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),source,compress_type=ZIP_DEFLATED)
    return hashlib.sha256(output.read_bytes()).hexdigest()


if __name__=='__main__':
    root=Path(sys.argv[1])
    root.mkdir(parents=True,exist_ok=True)
    (root/'customer-cash-review.template.json').write_text(json.dumps(build(),separators=(',',':'))+'\n')
    print(package(root/'customer-cash-review.zip'))
