"""Deploy the shared platform benefits contract on production-only identities and tables."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import CUSTOMER, REPO, ROOT, allow, attr, ref, sub, table
from prepare_merchant_profile import build as profile
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-platform-benefits'


def build():
    template = profile()
    template['Description'] = 'Staff platform benefits and read-only customer campaign and merchant discount preview.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'platform-benefits/[a-f0-9]{64}[.]zip'
    resources = template['Resources'] = {
        key: value for key, value in template['Resources'].items() if key in ('Api','Stage','Deployment')
    }
    dependencies = []

    def add(key, kind, **properties):
        resources[key] = {'Type':kind,'Condition':'IsProductionAccount','Properties':properties}

    configurations = json.loads((ROOT/'wallet-identity-bindings.json').read_text())['identities']
    admin, customer = configurations['admin'], configurations['customer']
    finance = json.loads((ROOT/'order-financial-runtime.template.json').read_text())
    wallet_keys = ('WALLETS_TABLE','LEDGER_TABLE','HOLDS_TABLE','TOPUP_REQUESTS_TABLE','AUDIT_LOG_TABLE',
                   'IDEMPOTENCY_KEYS_TABLE','ORDERS_TABLE','WALLET_LIFECYCLE_TABLE','STAFF_TABLE','OFFER_JOURNEY_TABLE')
    vars_by_type = {
        'Admin': {},
        'Customer': {
            **{key:finance['Resources']['Function']['Properties']['Environment']['Variables'][key] for key in wallet_keys},
            'USER_POOL_ID':customer['poolId'],'USER_POOL_CLIENT_ID':customer['clientId'],
            'COMMERCIAL_PRICING_MODE':'REQUIRED','PLATFORM_DISCOUNTS_TABLE':'wizz-production-PlatformDiscounts',
            'DISCOUNTS_TABLE':'wizz-production-MerchantDiscounts',
        },
    }
    grants = ('USER#*','BENEFIT_REQUEST#*')
    accounts = ('ACCOUNT_LIFECYCLE#CUSTOMER#*',)
    policies = {
        'Admin': [
            allow('cognito-idp:AdminGetUser',sub(
                'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + admin['poolId'])),
            allow('dynamodb:Query',table('Customers/index/phone-index')),
            allow('dynamodb:Scan',[table(name) for name in ('PlatformDiscounts','Merchants','Regions')]),
            *[dynamodb(name,verb) for name in ('Customers','PlatformDiscounts','Merchants','Regions')
              for verb in ('GetItem','ConditionCheckItem')],
            *[dynamodb('PlatformStaff',verb,('EMPLOYEE#*',)) for verb in ('GetItem','ConditionCheckItem')],
            *[dynamodb('OfferJourney',verb,grants) for verb in ('GetItem','PutItem')],
            *[dynamodb('AccountDeletion',verb,accounts) for verb in ('GetItem','ConditionCheckItem')],
            dynamodb('PlatformStaff','PutItem',('AUDIT#*',)),
            dynamodb('PlatformDiscounts','PutItem'),
        ],
        'Customer': [
            allow('dynamodb:GetItem',[table(name) for name in ('Customers','Regions','Addresses','PlatformDiscounts',
                                                             'MerchantDiscounts','Products','MenuCategories')]),
            allow('dynamodb:Scan',[table(name) for name in ('Orders','PlatformDiscounts')]),
            allow('dynamodb:Query',[table('PlatformDiscounts/index/code-index'),
                                    table('MerchantDiscounts/index/BusinessIdIndex')]),
            dynamodb('OfferJourney','GetItem',('USER#*',)),
            dynamodb('AccountDeletion','GetItem',accounts),
            dynamodb('MerchantPlatform','GetItem',('BRANCH#*',)),
        ],
    }
    for role, statements in policies.items():
        log = '/aws/lambda/' + NAME + '-' + role.lower()
        add(role+'Logs', 'AWS::Logs::LogGroup', LogGroupName=log,RetentionInDays=90)
        resources[role+'Logs'].update(DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
        statements.insert(0,allow(['logs:CreateLogStream','logs:PutLogEvents'],sub(
            'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')))
        add(role+'Role','AWS::IAM::Role',AssumeRolePolicyDocument={'Version':'2012-10-17','Statement':[
            {'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},
            Policies=[{'PolicyName':'ProductionBenefits'+role,'PolicyDocument':{'Version':'2012-10-17','Statement':statements}}])
        add(role+'Function','AWS::Lambda::Function',FunctionName=NAME+'-'+role.lower(),Runtime='nodejs22.x',
            Handler=role.lower()+'.handler',Role=attr(role+'Role','Arn'),MemorySize=512,Timeout=23,
            Environment={'Variables':{'STAGE':'production','ENVIRONMENT':'production','BENEFITS_API_ID':ref('Api'),
                          **vars_by_type[role]}},
            LoggingConfig={'LogGroup':ref(role+'Logs')},
            Code={'S3Bucket':'wizz-production-artifacts-746727375268-us-east-1','S3Key':ref('ArtifactKey'),
                  'S3ObjectVersion':ref('ArtifactVersion')})

    resources['Api']['Properties']['Name'] = NAME
    for base, part in [('Staff','staff'),('Promos','promo-codes')]:
        add(base,'AWS::ApiGateway::Resource',RestApiId=ref('Api'),ParentId=attr('Api','RootResourceId'),PathPart=part)
    add('Business','AWS::ApiGateway::Resource',RestApiId=ref('Api'),ParentId=attr('Api','RootResourceId'),PathPart='business')
    add('BusinessId','AWS::ApiGateway::Resource',RestApiId=ref('Api'),ParentId=ref('Business'),PathPart='{businessId}')
    for key, role, parent, part, permission_path, methods in (
        ('Benefits','Admin','Staff','benefits','staff/benefits',('GET','POST')),
        ('Active','Customer','Promos','active','promo-codes/active',('GET','OPTIONS')),
        ('Validate','Customer','Promos','validate','promo-codes/validate',('POST','OPTIONS')),
        ('Apply','Customer','Promos','apply','promo-codes/apply',('POST','OPTIONS')),
        ('MerchantDiscounts','Customer','BusinessId','discounts','business/*/discounts',('GET','OPTIONS')),
    ):
        add(key,'AWS::ApiGateway::Resource',RestApiId=ref('Api'),ParentId=ref(parent),PathPart=part)
        for verb in methods:
            logical = key + verb
            add(logical,'AWS::ApiGateway::Method',RestApiId=ref('Api'),ResourceId=ref(key),HttpMethod=verb,
                AuthorizationType='NONE',Integration={'Type':'AWS_PROXY','IntegrationHttpMethod':'POST',
                  'Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${'
                            +role+'Function.Arn}/invocations')})
            add(logical+'Invoke','AWS::Lambda::Permission',Action='lambda:InvokeFunction',FunctionName=ref(role+'Function'),
                Principal='apigateway.amazonaws.com',SourceAccount=ref('AWS::AccountId'),
                SourceArn=sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+verb+'/'+permission_path))
            dependencies.extend((logical,logical+'Invoke'))
    deployment = resources['MerchantDiscountsDeployment'] = resources.pop('Deployment')
    deployment['DependsOn'] = dependencies
    resources['Stage']['Properties']['DeploymentId'] = ref('MerchantDiscountsDeployment')
    return template


def package(out):
    out.mkdir(parents=True,exist_ok=True)
    modules = REPO/'backend/wallet-service/node_modules'
    env = {**os.environ,'NODE_PATH':os.pathsep.join(map(str,[
        modules, REPO/'backend/node_modules', REPO/'backend/staff-service/node_modules',
    ]))}
    artifact = out/'platform-benefits.zip'
    with ZipFile(artifact,'w') as archive:
        for label, repo, source in [
            ('admin',REPO,'infrastructure/production/platform-benefits-admin.cjs'),
            ('customer',CUSTOMER,'src/production/customer-platform-benefits.js'),
        ]:
            bundle=subprocess.check_output([str(modules/'.bin/esbuild'),source,'--bundle','--platform=node','--target=node22',
                '--format=cjs','--keep-names','--log-level=error','--external:@aws-sdk/*'],cwd=repo,env=env)
            archive.writestr(ZipInfo(label+'.js',(2026,1,1,0,0,0)),bundle,compress_type=ZIP_DEFLATED)
    (out/'platform-benefits.template.json').write_text(json.dumps(build(),separators=(',',':'))+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())


if __name__ == '__main__':
    package(Path(sys.argv[1]).resolve())
