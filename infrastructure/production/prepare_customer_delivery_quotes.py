"""Prepare the delivery quote Lambda and add its route to the production storefront API."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import BUCKET, CUSTOMER, REPO, ROOT, allow, attr, build as storefront, ref, sub, table

NAME = 'wizz-production-customer-delivery-quotes'
ROUTE = 'delivery-quotes'


def package(output):
    runtime = subprocess.check_output([
        str(REPO / 'backend/wallet-service/node_modules/.bin/esbuild'),
        'backend/wallet-service/src/deliveryQuoteRuntime.ts', '--bundle', '--platform=node',
        '--target=node22', '--format=cjs', '--log-level=error',
    ], cwd=REPO)
    sources = {
        'production/customer-delivery-quotes.js': (CUSTOMER / 'src/production/customer-delivery-quotes.js').read_bytes(),
        'functions/create-order/account-guard.js': (CUSTOMER / 'src/functions/create-order/account-guard.js').read_bytes(),
        'functions/delivery-quotes/runtime.js': runtime,
    }
    with ZipFile(output, 'w') as archive:
        for name, payload in sources.items():
            archive.writestr(ZipInfo(name, (2026, 1, 1, 0, 0, 0)), payload, compress_type=ZIP_DEFLATED)


def leading(*keys):
    return {
        'ForAllValues:StringLike': {'dynamodb:LeadingKeys': list(keys)},
        'Null': {'dynamodb:LeadingKeys': 'false'},
    }


def build():
    template = storefront()
    template['Parameters'].update({
        'QuoteArtifactKey': {'Type': 'String', 'AllowedPattern': 'customer-delivery-quotes/[a-f0-9]{64}[.]zip'},
        'QuoteArtifactVersion': {'Type': 'String', 'MinLength': 1},
        'MapboxRoutingSecretArn': {
            'Type': 'String',
            'AllowedPattern': 'arn:aws:secretsmanager:us-east-1:746727375268:secret:production/finance/mapbox/server-routing-[A-Za-z0-9]{6}',
        },
    })
    resources = template['Resources']

    def add(key, kind, props, **attributes):
        resources[key] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': props, **attributes}

    log = '/aws/lambda/' + NAME
    add('DeliveryQuotesLogs', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    quote_access = leading('CUSTOMER#*')
    policy = [
        allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
        allow('secretsmanager:GetSecretValue', ref('MapboxRoutingSecretArn')),
        allow(['dynamodb:GetItem', 'dynamodb:ConditionCheckItem'], table('DeliveryQuotes'), quote_access),
        allow('dynamodb:PutItem', table('DeliveryQuotes'), {
            **quote_access, 'StringEquals': {'dynamodb:EnclosingOperation': 'TransactWriteItems'},
        }),
        allow(['dynamodb:GetItem', 'dynamodb:ConditionCheckItem'],
              [table(name) for name in ('Customers', 'Addresses', 'Merchants', 'Regions', 'RegionsDerived', 'RegionNeighbors')]),
        allow(['dynamodb:GetItem', 'dynamodb:ConditionCheckItem'], table('PlatformStaff'),
              leading('OPERATIONAL_SETTINGS#DELIVERY_PRICING', 'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS')),
        allow(['dynamodb:GetItem', 'dynamodb:ConditionCheckItem'], table('MerchantPlatform'), leading('PERSON#*')),
        allow(['dynamodb:GetItem', 'dynamodb:ConditionCheckItem'], table('AccountDeletion'),
              leading('BUSINESS_LIFECYCLE#MERCHANT#*', 'ACCOUNT_LIFECYCLE#MERCHANT#*')),
        allow('dynamodb:Query', table('RegionIndex/index/h3-index')),
    ]
    add('DeliveryQuotesRole', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [{
            'Effect': 'Allow', 'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole',
        }]},
        'Policies': [{'PolicyName': 'CustomerQuoteStorage', 'PolicyDocument': {'Version': '2012-10-17', 'Statement': policy}}],
    })
    customer = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())['identities']['customer']
    finance_env = json.loads((ROOT / 'order-financial-runtime.template.json').read_text())['Resources']['Function']['Properties']['Environment']['Variables']
    env = {key: finance_env[key] for key in ('WALLETS_TABLE', 'LEDGER_TABLE', 'HOLDS_TABLE', 'TOPUP_REQUESTS_TABLE',
           'AUDIT_LOG_TABLE', 'IDEMPOTENCY_KEYS_TABLE', 'ORDERS_TABLE', 'WALLET_LIFECYCLE_TABLE', 'STAFF_TABLE', 'OFFER_JOURNEY_TABLE')}
    env.update(ENVIRONMENT='production', USERS_TABLE='wizz-production-Customers', USER_POOL_ID=customer['poolId'],
               USER_POOL_CLIENT_ID=customer['clientId'], MAPBOX_SECRET_ARN=ref('MapboxRoutingSecretArn'),
               DELIVERY_QUOTE_MAX_PER_MINUTE='5', DELIVERY_OPERATIONS_MODE='CENTRAL')
    add('DeliveryQuotesFunction', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Runtime': 'nodejs22.x', 'Handler': 'production/customer-delivery-quotes.handler',
        'Role': attr('DeliveryQuotesRole', 'Arn'), 'Environment': {'Variables': env},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('QuoteArtifactKey'), 'S3ObjectVersion': ref('QuoteArtifactVersion')},
        'MemorySize': 512, 'Timeout': 20, 'LoggingConfig': {'LogGroup': ref('DeliveryQuotesLogs')},
    })
    add('DeliveryQuotesInvoke', 'AWS::Lambda::Permission', {
        'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com',
        'FunctionName': ref('DeliveryQuotesFunction'), 'SourceAccount': ref('AWS::AccountId'),
        'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/*/' + ROUTE),
    })
    add('DeliveryQuotesPath', 'AWS::ApiGateway::Resource', {
        'RestApiId': ref('Api'), 'ParentId': attr('Api', 'RootResourceId'), 'PathPart': ROUTE,
    })
    methods = []
    for verb in ('GET', 'POST', 'OPTIONS'):
        key = 'DeliveryQuotes' + verb
        methods.append(key)
        add(key, 'AWS::ApiGateway::Method', {
            'RestApiId': ref('Api'), 'ResourceId': ref('DeliveryQuotesPath'), 'HttpMethod': verb,
            'AuthorizationType': 'NONE',
            'Integration': {'IntegrationHttpMethod': 'POST', 'Type': 'AWS_PROXY',
                            'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
                                       '${DeliveryQuotesFunction.Arn}/invocations')},
        })
    stage = resources['Stage']['Properties']
    previous = stage['DeploymentId']['Ref']
    deployment = resources.pop(previous)
    deployment['DependsOn'] += [*methods, 'DeliveryQuotesInvoke']
    key = previous + 'DeliveryQuotes'
    resources[key] = deployment
    stage['DeploymentId'] = ref(key)
    stage['MethodSettings'].append({
        'ResourcePath': '/~1' + ROUTE, 'HttpMethod': 'POST',
        'ThrottlingBurstLimit': 10, 'ThrottlingRateLimit': 5, 'DataTraceEnabled': False,
    })
    return template


if __name__ == '__main__':
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    artifact = output / 'customer-delivery-quotes.zip'
    package(artifact)
    (output / 'customer-delivery-quotes.template.json').write_text(json.dumps(build(), indent=2) + '\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
