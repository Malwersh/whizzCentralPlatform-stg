"""Package the driver quality service and attach its routes to the current production gateways."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import BUCKET, REPO, ROOT, allow, attr, ref, sub, table

NAME = 'wizz-production-driver-quality'
DRIVER_GATEWAY = 'wizz-production-driver-profile'
STAFF_GATEWAY = 'wizz-production-driver-review'


def build():
    base = json.loads((ROOT/'storage-auth.template.json').read_text())
    template = {key:base[key] for key in ('AWSTemplateFormatVersion','Conditions')}
    template['Description'] = 'Driver quality, timing and rating cases, with authenticated staff review.'
    template['Parameters'] = {
        'ExpectedAccountId':base['Parameters']['ExpectedAccountId'],
        'ArtifactKey':{'Type':'String','AllowedPattern':'driver-quality/[a-f0-9]{64}[.]zip'},
        'ArtifactVersion':{'Type':'String','MinLength':1},
    }
    bindings = json.loads((ROOT/'wallet-identity-bindings.json').read_text())['identities']
    env = {'ENVIRONMENT':'production'}
    for role, identity in bindings.items():
        env[role.upper()+'_USER_POOL_ID'] = identity['poolId']
        env[role.upper()+'_CLIENT_ID'] = identity['clientId']
    for key, name in {
        'WALLETS_TABLE':'Wallets', 'LEDGER_TABLE':'LedgerEntries', 'HOLDS_TABLE':'Holds',
        'TOPUP_REQUESTS_TABLE':'TopupRequests','AUDIT_LOG_TABLE':'AuditLog', 'IDEMPOTENCY_KEYS_TABLE':'IdempotencyKeys',
        'ORDERS_TABLE':'Orders','WALLET_LIFECYCLE_TABLE':'WalletLifecycle','STAFF_TABLE':'PlatformStaff',
        'OFFER_JOURNEY_TABLE':'OfferJourney','DISPATCH_JOBS_TABLE':'DispatchJobs','DRIVER_LIVE_STATE_TABLE':'DriverLiveState',
        'WAVE_OFFERS_TABLE':'WaveOffers','DELIVERY_QUOTES_TABLE':'DeliveryQuotes','DRIVERS_TABLE':'Drivers',
        'MERCHANTS_TABLE':'Merchants','ACCOUNT_DELETION_TABLE':'AccountDeletion','RATINGS_TABLE':'OrderRatings',
    }.items():
        env[key] = 'wizz-production-'+name
    log = '/aws/lambda/'+NAME
    transaction = {'StringEquals':{'dynamodb:EnclosingOperation':'TransactWriteItems'}}
    resource_only = lambda prefix: {'ForAllValues:StringLike':{'dynamodb:LeadingKeys':[prefix]}}
    def attribute_keys(attributes, prefix=None):
        return {
            **transaction,
            'ForAllValues:StringEquals':{'dynamodb:Attributes':attributes},
            'Null':{'dynamodb:Attributes':'false',**({'dynamodb:LeadingKeys':'false'} if prefix else {})},
            **(resource_only(prefix) if prefix else {}),
        }
    resources = template['Resources'] = {}
    def add(key, kind, props):
        resources[key] = {'Type':kind,'Condition':'IsProductionAccount','Properties':props}
    add('LogGroup','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':90})
    resources['LogGroup']['DeletionPolicy'] = 'Retain'
    resources['LogGroup']['UpdateReplacePolicy'] = 'Retain'
    statements = [
        allow(['logs:CreateLogStream','logs:PutLogEvents'],sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')),
        allow('cognito-idp:AdminGetUser',[sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/'+bindings[role]['poolId']) for role in ('driver','admin')]),
        allow('dynamodb:GetItem',[table(name) for name in ('Drivers','Orders','WaveOffers','Holds','WalletLifecycle','DispatchJobs')]),
        allow('dynamodb:GetItem',table('PlatformStaff'),resource_only('EMPLOYEE#*')),
        allow(['dynamodb:GetItem','dynamodb:ConditionCheckItem'],table('AccountDeletion'),resource_only('ACCOUNT_LIFECYCLE#DRIVER#*')),
        allow('dynamodb:ConditionCheckItem',[table(name) for name in ('Drivers','Orders','WaveOffers','Holds','WalletLifecycle')],transaction),
        allow('dynamodb:ConditionCheckItem',table('PlatformStaff'),{**transaction,**resource_only('EMPLOYEE#*')}),
        allow('dynamodb:Query',[table(name) for name in ('WaveOffers/index/driverId-sentAt-index','Holds','Orders/index/GSI_OrderNumber')]),
        allow('dynamodb:PutItem',table('Holds'),transaction),
        allow('dynamodb:PutItem',table('WalletLifecycle'),{**transaction,**resource_only('EXCEPTION_CASE#*')}),
        allow('dynamodb:PutItem',table('AuditLog'),{**transaction,**resource_only('date#*')}),
        allow('dynamodb:GetItem',table('OrderRatings'),{
            'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ORDER#*','DRIVER#*']},
            'Null':{'dynamodb:LeadingKeys':'false'},
        }),
        allow('dynamodb:ConditionCheckItem',table('OrderRatings'),{**transaction,**resource_only('DRIVER#*')}),
        allow('dynamodb:UpdateItem',table('OrderRatings'),attribute_keys([
            'pk','orderId','subjectId','merchantId','driverId','merchantStars','driverStars','comment','createdAt','driverModeration',
        ], 'ORDER#*')),
        allow('dynamodb:UpdateItem',table('OrderRatings'),attribute_keys([
            'pk','count','sum','average','underReviewCount','excludedCount','version',
        ], 'DRIVER#*')),
        allow('dynamodb:UpdateItem',table('Drivers'),attribute_keys([
            'driverId','customerRating','customerRatingCount','customerRatingSum','customerRatingUpdatedAt',
            'customerRatingUnderReviewCount','customerRatingExcludedCount','work_region_id','cognitoSub',
            'isDeleted','deletedAt','deletionRequestId',
        ])),
    ]
    add('Role','AWS::IAM::Role',{
        'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[
            {'Effect':'Allow','Action':'sts:AssumeRole','Principal':{'Service':'lambda.amazonaws.com'}},
        ]},
        'Policies':[{'PolicyName':'QualityCasesAndAppeals','PolicyDocument':{'Version':'2012-10-17','Statement':statements}}],
    })
    add('Function','AWS::Lambda::Function',{
        'FunctionName':NAME,'Runtime':'nodejs22.x','Handler':'index.handler','Timeout':27,'MemorySize':512,
        'Code':{'S3Bucket':BUCKET,'S3Key':ref('ArtifactKey'),'S3ObjectVersion':ref('ArtifactVersion')},
        'Role':attr('Role','Arn'),'LoggingConfig':{'LogGroup':ref('LogGroup')},'Environment':{'Variables':env},
    })
    return template


def attach_gateway(template, staff):
    resources = template['Resources']
    def add(key, kind, props):
        assert key not in resources, key
        resources[key] = {'Type':kind,'Condition':'IsProductionAccount','Properties':props}

    add('QualityResource','AWS::ApiGateway::Resource',{
        'RestApiId':ref('Api'),'ParentId':ref('DriverResource'),
        'PathPart':'quality' if staff else 'quality-incidents',
    })
    if not staff:
        add('QualityAppealResource','AWS::ApiGateway::Resource',{
            'RestApiId':ref('Api'),'ParentId':ref('QualityResource'),'PathPart':'appeal',
        })
    routes = (
        [('Quality','Quality','GET','staff/drivers/*/quality'),('QualityAction','Quality','POST','staff/drivers/*/quality')]
        if staff else [('Quality','Quality','GET','driver/quality-incidents'),('QualityAppeal','QualityAppeal','POST','driver/quality-incidents/appeal')]
    )
    depends = []
    for key, resource, method, path in routes:
        add(key+'Method','AWS::ApiGateway::Method',{
            'RestApiId':ref('Api'),'ResourceId':ref(resource+'Resource'),'HttpMethod':method,'AuthorizationType':'NONE',
            'Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST','Uri':sub(
                'arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:'+NAME+'/invocations')},
        })
        add(key+'Invoke','AWS::Lambda::Permission',{
            'Action':'lambda:InvokeFunction','FunctionName':NAME,'Principal':'apigateway.amazonaws.com',
            'SourceAccount':ref('AWS::AccountId'),'SourceArn':sub(
                'arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+method+'/'+path),
        })
        depends += [key+'Method',key+'Invoke']
    prior = resources['Stage']['Properties']['DeploymentId']['Ref']
    add('QualityDeployment','AWS::ApiGateway::Deployment',{'RestApiId':ref('Api')})
    resources['QualityDeployment']['DependsOn'] = resources[prior]['DependsOn']+depends
    resources['Stage']['Properties']['DeploymentId'] = ref('QualityDeployment')
    return template


def write(out):
    out.mkdir(parents=True,exist_ok=True)
    bundle = subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),
        'backend/wallet-service/src/productionDriverQuality.ts','--bundle','--platform=node',
        '--target=node22','--format=cjs','--log-level=error','--external:@aws-sdk/*',
    ],cwd=REPO)
    artifact=out/'driver-quality.zip'
    with ZipFile(artifact,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),bundle,compress_type=ZIP_DEFLATED)
    (out/'quality.template.json').write_text(json.dumps(build(),indent=2)+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())


if __name__=='__main__':
    write(Path(sys.argv[1]))
