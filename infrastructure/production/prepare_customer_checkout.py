"""Package the existing customer checkout flow for the production storefront."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_delivery_quotes import leading
from prepare_customer_order_reads import build as order_reads
from prepare_customer_storefront import BUCKET, CUSTOMER, REPO, ROOT, allow, attr, ref, sub, table

NAME = 'wizz-production-customer-checkout'
ACCOUNT = '746727375268'
REGION = 'us-east-1'


def package(output):
    modules = REPO / 'backend/wallet-service/node_modules'
    bundle = subprocess.check_output([
        str(modules / '.bin/esbuild'), 'src/production/customer-checkout.js', '--bundle',
        '--platform=node', '--target=node22', '--format=cjs', '--keep-names', '--log-level=error', '--drop:console',
    ], cwd=CUSTOMER, env={**os.environ, 'NODE_PATH': str(modules)})
    with ZipFile(output, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), bundle, compress_type=ZIP_DEFLATED)


def build(baseline):
    """Extend a current storefront template while preserving its deployed bindings."""
    template = json.loads(json.dumps(baseline))
    resources = template['Resources']
    assert resources['Api']['Properties']['Name'] == 'wizz-production-customer-storefront'
    assert resources['OrdersRoot']['Properties']['PathPart'] == 'orders'
    template['Parameters'].update({
        'CheckoutArtifactKey': {'Type': 'String', 'AllowedPattern': 'customer-checkout/[a-f0-9]{64}[.]zip'},
        'CheckoutArtifactVersion': {'Type': 'String', 'MinLength': 1},
    })

    def add(name, kind, properties, **attributes):
        if name in resources:
            raise ValueError('Resource already present: ' + name)
        resources[name] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': properties, **attributes}

    def ddb(actions, names, keys=(), transactional=False):
        condition = leading(*keys) if keys else {}
        if transactional:
            condition['StringEquals'] = {'dynamodb:EnclosingOperation': 'TransactWriteItems'}
        return allow(['dynamodb:' + action for action in actions], [table(name) for name in names], condition)

    log = '/aws/lambda/' + NAME
    add('CheckoutLogGroup', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    campaign = ('DELIVERY_BUDGET#*', 'DELIVERY_USAGE#*', 'DELIVERY_RESERVATION#*')
    settings = ('OPERATIONAL_SETTINGS#DELIVERY_PRICING', 'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS',
                'OPERATIONAL_SETTINGS#CASH_ROUNDING', 'OPERATIONAL_SETTINGS#ORDER_RECEPTION',
                'COMMERCIAL_AGREEMENT#*', 'DELIVERY_FUNDING#*', 'DISCOUNT_FUNDING#*', 'EMPLOYEE#*',
                'HOME_SLIDESHOW', *campaign)
    life = ('BUSINESS_LIFECYCLE#MERCHANT#*', 'ACCOUNT_LIFECYCLE#MERCHANT#*')
    merchant = ('BRANCH#*', 'PERSON#*', 'COMMERCIAL_AGREEMENT#*')
    offer = ('USER#*', 'BENEFIT_ORDER#*', 'STATS#*')
    references = ('Customers', 'Addresses', 'Merchants', 'Regions', 'RegionsDerived', 'RegionNeighbors',
                  'MenuCategories', 'Products', 'MerchantDiscounts', 'PlatformDiscounts', 'Holds')
    scoped = [('Orders', ('ORDER#*',)), ('DeliveryQuotes', ('CUSTOMER#*',)), ('AccountDeletion', life),
              ('MerchantPlatform', merchant), ('PlatformStaff', settings), ('OfferJourney', offer),
              ('Wallets', ('WALLET#PLATFORM',))]
    statements = [
        allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
        ddb(('GetItem',), references),
        # ConditionCheckItem is exclusive to DynamoDB transactions and does
        # not support the EnclosingOperation condition key.
        ddb(('ConditionCheckItem',), references),
        *[ddb(('GetItem',), (name,), keys) for name, keys in scoped],
        *[ddb(('ConditionCheckItem',), (name,), keys) for name, keys in scoped],
        ddb(('Query',), ('Orders/index/GSI_User', 'PlatformDiscounts/index/code-index')),
        ddb(('Query',), ('MerchantPlatform',), ('BRANCH#*',)),
        # Existing eligibility logic counts terminal historical orders for a new customer counter.
        ddb(('Scan',), ('Orders',)),
        ddb(('PutItem',), ('Orders',), ('ORDER#*',), transactional=True),
        ddb(('UpdateItem',), ('DeliveryQuotes',), ('CUSTOMER#*',), transactional=True),
        ddb(('PutItem',), ('WalletLifecycle',), ('MERCHANT_RESPONSE#*',), transactional=True),
        ddb(('PutItem',), ('MerchantPlatform',), ('BRANCH#*',), transactional=True),
        ddb(('UpdateItem',), ('Products', 'MerchantDiscounts', 'PlatformDiscounts'), transactional=True),
        ddb(('PutItem',), ('PlatformStaff',), campaign, transactional=True),
        ddb(('PutItem',), ('OfferJourney',), ('USER#*', 'BENEFIT_ORDER#*'), transactional=True),
        ddb(('UpdateItem',), ('OfferJourney',), ('STATS#*',), transactional=True),
        ddb(('UpdateItem',), ('Wallets',), ('WALLET#PLATFORM',), transactional=True),
        ddb(('PutItem',), ('LedgerEntries',), ('WALLET#PLATFORM',), transactional=True),
        ddb(('PutItem',), ('Holds',), transactional=True),
        ddb(('PutItem',), ('AuditLog',), ('date#*',), transactional=True),
    ]
    read_actions = {'logs:CreateLogStream', 'logs:PutLogEvents',
                    'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'}
    reads = [statement for statement in statements if set(statement['Action']) <= read_actions]
    transactions = [statement for statement in statements if statement not in reads]
    add('CheckoutReadPolicy', 'AWS::IAM::ManagedPolicy', {
        'PolicyDocument': {'Version': '2012-10-17', 'Statement': reads},
    })
    add('CheckoutRole', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [{
            'Effect': 'Allow', 'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole',
        }]},
        'ManagedPolicyArns': [ref('CheckoutReadPolicy')],
        'Policies': [{'PolicyName': 'CheckoutTransactionsOnly', 'PolicyDocument': {
            'Version': '2012-10-17', 'Statement': transactions}}],
    })
    finance = json.loads((ROOT / 'order-financial-runtime.template.json').read_text())
    env = {key: value for key, value in finance['Resources']['Function']['Properties']['Environment']['Variables'].items()
           if isinstance(value, str) and key != 'DELIVERY_OPERATIONS_MODE'}
    customer = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())['identities']['customer']
    rollout = {'accountId': ACCOUNT, 'region': REGION, 'schemaVersion': 1, 'scopes': []}
    encoded = json.dumps(rollout, separators=(',', ':'), sort_keys=True)
    env.update(STAGE='production', ENVIRONMENT='production',
               USER_POOL_ID=customer['poolId'], USER_POOL_CLIENT_ID=customer['clientId'],
               USERS_TABLE='wizz-production-Customers', ADDRESSES_TABLE='wizz-production-Addresses',
               WIZZORDERS_TABLE='wizz-production-Orders', BUSINESSES_TABLE='wizz-production-Merchants',
               DELIVERY_QUOTE_MODE='REQUIRED', COMMERCIAL_PRICING_MODE='REQUIRED',
               CASH_ROUNDING_POLICY_MODE='REQUIRED', FINANCE_GENERAL_RELEASE_MODE='REQUIRED',
               MERCHANT_RESPONSE_MODE='REQUIRED', DELIVERY_PROMOTION_MODE='REQUIRED',
               FINANCE_ROLLOUT_CONFIG=encoded, FINANCE_ROLLOUT_SHA256=hashlib.sha256(encoded.encode()).hexdigest())
    add('CheckoutFunction', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Runtime': 'nodejs22.x', 'Handler': 'index.handler',
        'Role': attr('CheckoutRole', 'Arn'), 'Environment': {'Variables': env},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('CheckoutArtifactKey'), 'S3ObjectVersion': ref('CheckoutArtifactVersion')},
        'MemorySize': 512, 'Timeout': 27, 'LoggingConfig': {'LogGroup': ref('CheckoutLogGroup')},
    })
    add('CheckoutPreviewPath', 'AWS::ApiGateway::Resource', {
        'RestApiId': ref('Api'), 'ParentId': ref('OrdersRoot'), 'PathPart': 'commercial-preview',
    })
    dependencies = []
    for path, resource in [('orders', 'OrdersRoot'), ('orders/commercial-preview', 'CheckoutPreviewPath')]:
        for method in ('POST', 'OPTIONS'):
            name = ('CheckoutPreview' if resource == 'CheckoutPreviewPath' else 'CheckoutCreate') + method
            add(name, 'AWS::ApiGateway::Method', {
                'RestApiId': ref('Api'), 'ResourceId': ref(resource), 'HttpMethod': method,
                'AuthorizationType': 'NONE',
                'Integration': {'IntegrationHttpMethod': 'POST', 'Type': 'AWS_PROXY',
                                'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
                                           '${CheckoutFunction.Arn}/invocations')},
            })
            add(name + 'Invoke', 'AWS::Lambda::Permission', {
                'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com',
                'FunctionName': ref('CheckoutFunction'), 'SourceAccount': ref('AWS::AccountId'),
                'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/' + method + '/' + path),
            })
            dependencies.extend([name, name + 'Invoke'])
    stage = resources['Stage']['Properties']
    previous = stage['DeploymentId']['Ref']
    deployment = resources.pop(previous)
    deployment['DependsOn'] += dependencies
    current = previous + 'Checkout'
    resources[current] = deployment
    stage['DeploymentId'] = ref(current)
    return template


if __name__ == '__main__':
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    baseline = json.loads(Path(sys.argv[2]).read_text()) if len(sys.argv) > 2 else order_reads()
    archive = output / 'customer-checkout.zip'
    package(archive)
    (output / 'customer-checkout.template.json').write_text(json.dumps(build(baseline), indent=2) + '\n')
    print(hashlib.sha256(archive.read_bytes()).hexdigest())
