"""Package merchant staff membership, paired device sessions and delegated settlements."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import BUCKET, REPO, ROOT, allow, attr, ref, sub, table
from prepare_merchant_financial_session import build as verification_template
from prepare_merchant_settlements import permissions as settlement_permissions
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-merchant-branch-finance'
POLICY = ('OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',)
DELETION = ('ACCOUNT_LIFECYCLE#MERCHANT#*', 'BUSINESS_LIFECYCLE#MERCHANT#*')
ROUTES = {
    'Membership': ('/auth/branch-staff', ('GET', 'POST'), 'Access'),
    'Management': ('/auth/branch-devices', ('GET', 'POST'), 'Access'),
    'Session': ('/branch-device', ('POST',), 'Access'),
    'Delegated': ('/branch-device/settlements', ('POST',), 'Finance'),
}


def permissions(access):
    if access:
        staff = ('BRANCH#*', 'PERSON#*', 'STAFF_PHONE#*')
        merchant = json.loads((ROOT/'wallet-identity-bindings.json').read_text())['identities']['merchant']
        return [
            *[dynamodb('MerchantPlatform', action, staff)
              for action in ('GetItem', 'Query', 'ConditionCheckItem', 'PutItem')],
            *[dynamodb('Merchants', action) for action in ('GetItem', 'ConditionCheckItem')],
            *[dynamodb('AccountDeletion', action, DELETION) for action in ('GetItem', 'ConditionCheckItem')],
            *[dynamodb('PlatformStaff', action, POLICY) for action in ('GetItem', 'ConditionCheckItem')],
            *[dynamodb('MerchantDiscounts', action)
              for action in ('GetItem', 'ConditionCheckItem', 'PutItem', 'UpdateItem', 'DeleteItem')],
            allow('dynamodb:Query', table('MerchantDiscounts/index/BusinessIdIndex')),
            *[dynamodb('MerchantPlatform', action, ('CAMPAIGN_SHARING_LOCK#MERCHANT#*',))
              for action in ('GetItem', 'ConditionCheckItem')],
            allow('cognito-idp:AdminGetUser', sub(
                'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + merchant['poolId'])),
        ]
    base = [statement for statement in settlement_permissions(True) if not any(
        statement['Resource']['Fn::Sub'].endswith('-' + name)
        for name in ('MerchantFinancialSessions', 'PushDeviceTokens', 'PlatformStaff')
    )]
    return base + [dynamodb('PlatformStaff', action, POLICY) for action in ('GetItem', 'ConditionCheckItem')]


def build():
    reference = verification_template()
    template = {key: reference[key] for key in ('AWSTemplateFormatVersion', 'Rules', 'Conditions')}
    template['Description'] = 'Production branch staff memberships, device sessions and delegated merchant settlements.'
    template['Parameters'] = {key: value for key, value in reference['Parameters'].items() if key != 'MerchantOtpSecret'}
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'merchant-branch-finance/[a-f0-9]{64}[.]zip'
    resources = template['Resources'] = {}

    def add(key, kind, properties, **extra):
        resources[key] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': properties, **extra}

    finance_env = {key: 'wizz-production-' + table for key, table in {
        'WALLETS_TABLE': 'Wallets', 'LEDGER_TABLE': 'LedgerEntries', 'HOLDS_TABLE': 'Holds',
        'TOPUP_REQUESTS_TABLE': 'TopupRequests', 'AUDIT_LOG_TABLE': 'AuditLog', 'IDEMPOTENCY_KEYS_TABLE': 'IdempotencyKeys',
        'ORDERS_TABLE': 'Orders', 'ACCOUNT_DELETION_TABLE': 'AccountDeletion', 'STAFF_TABLE': 'PlatformStaff',
        'OFFER_JOURNEY_TABLE': 'OfferJourney', 'DISPATCH_JOBS_TABLE': 'DispatchJobs', 'DRIVER_LIVE_STATE_TABLE': 'DriverLiveState',
        'DRIVERS_TABLE': 'Drivers', 'MERCHANTS_TABLE': 'Merchants', 'WAVE_OFFERS_TABLE': 'WaveOffers',
        'DELIVERY_QUOTES_TABLE': 'DeliveryQuotes', 'WALLET_LIFECYCLE_TABLE': 'WalletLifecycle',
        'WALLET_NOTIFICATIONS_TABLE': 'WalletNotifications',
    }.items()}
    finance_env.update(MERCHANT_PAYOUT_NOTIFICATIONS_ENABLED='true', MERCHANT_FINANCIAL_DEVICE_POLICY_ENABLED='true')
    # Both handlers load the shared settlement module at startup. Their IAM roles limit which tables they can use.
    merchant_client = json.loads((ROOT/'wallet-identity-bindings.json').read_text())['identities']['merchant']['clientId']
    for label in ('Access', 'Finance'):
        access = label == 'Access'
        name = NAME + '-' + label.lower()
        log = '/aws/lambda/' + name
        add(label+'Log', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
            DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
        add(label+'Role', 'AWS::IAM::Role', {
            'AssumeRolePolicyDocument': reference['Resources']['Role']['Properties']['AssumeRolePolicyDocument'],
            'Policies': [{'PolicyName': 'MerchantBranchFinance', 'PolicyDocument': {'Version': '2012-10-17', 'Statement': [
                allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
                      sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
                *permissions(access),
            ]}}],
        })
        add(label+'Function', 'AWS::Lambda::Function', {
            'FunctionName': name, 'Runtime': 'nodejs22.x', 'Handler': 'index.' + label.lower(),
            'Role': attr(label+'Role', 'Arn'), 'Timeout': 24, 'MemorySize': 512,
            'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
            'LoggingConfig': {'LogGroup': ref(label+'Log')},
            'Environment': {'Variables': {'ENVIRONMENT': 'production', 'PLATFORM_ENVIRONMENT': 'production',
                                          'MERCHANT_STAFF_PERMISSION_MODE': 'CENTRAL',
                                          **finance_env, **({'COGNITO_CLIENT_ID': merchant_client} if access else {})}},
        })
    add('Api', 'AWS::ApiGateway::RestApi', {'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']}})
    resources_by_path = {'': attr('Api', 'RootResourceId')}
    dependencies = []
    for label, (path, methods, audience) in ROUTES.items():
        parent = ''
        for part in path.strip('/').split('/'):
            current = parent + '/' + part
            if current not in resources_by_path:
                key = label + 'Resource' + str(len(resources_by_path))
                add(key, 'AWS::ApiGateway::Resource', {
                    'RestApiId': ref('Api'), 'ParentId': resources_by_path[parent], 'PathPart': part,
                })
                resources_by_path[current] = ref(key)
            parent = current
        function = audience + 'Function'
        for method in methods:
            key = label + method
            add(key, 'AWS::ApiGateway::Method', {
                'RestApiId': ref('Api'), 'ResourceId': resources_by_path[path], 'HttpMethod': method,
                'AuthorizationType': 'NONE', 'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST',
                    'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
                               + '${' + function + '.Arn}/invocations')},
            })
            add(key+'Invoke', 'AWS::Lambda::Permission', {
                'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com',
                'FunctionName': ref(function), 'SourceAccount': ref('AWS::AccountId'),
                'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'
                                 + method + path),
            })
            dependencies.extend([key, key+'Invoke'])
    add('Deployment', 'AWS::ApiGateway::Deployment', {'RestApiId': ref('Api')}, DependsOn=dependencies)
    stage = reference['Resources']['Stage']
    stage['Properties']['MethodSettings'][0]['ThrottlingRateLimit'] = 30
    stage['Properties']['MethodSettings'][0]['ThrottlingBurstLimit'] = 60
    resources['Stage'] = stage
    template['Outputs'] = reference['Outputs']
    return template


def package(out):
    target = out/'index.js'
    subprocess.run(['node', str(ROOT/'merchant-settlements/bundle.cjs'),
                    str(ROOT/'merchant-branch-finance/index.cjs'), str(target)], cwd=REPO, check=True)
    artifact = out/'merchant-branch-finance.zip'
    with ZipFile(artifact, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), target.read_bytes(), compress_type=ZIP_DEFLATED)
    return hashlib.sha256(artifact.read_bytes()).hexdigest()


if __name__ == '__main__':
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    (out/'merchant-branch-finance.template.json').write_text(json.dumps(build(), separators=(',', ':')) + '\n')
    print(package(out))
