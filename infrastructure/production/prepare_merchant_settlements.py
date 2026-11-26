"""Package the production merchant and central finance APIs from the staging workflow source."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import ROOT, REPO, BUCKET, allow, attr, ref, sub
from prepare_merchant_financial_session import SESSION, build as verification_template
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-merchant-settlements'
ROUTES = {
    'Owner': ('/auth/settlement-schedules', ('GET', 'POST', 'OPTIONS')),
    'Staff': ('/staff/settlement-schedules', ('GET', 'POST')),
    'Branches': ('/staff/settlement-schedules/branches', ('GET',)),
}


def permissions(owner):
    merchant = ('WALLET#MERCHANT#*',)
    platform = (
        'BRANCH#*', 'COMMERCIAL_AGREEMENT#*', 'PERSON#*', 'MERCHANT_SETTLEMENT#*',
        'MERCHANT_PAYOUT#*', 'MERCHANT_PAYOUT_DESTINATION#*', 'MERCHANT_PAYOUT_PAID#*',
        'MERCHANT_CORRECTIONS#*', 'MERCHANT_CASHBOX#*', 'MERCHANT_ACCRUAL#*',
        'FULL_CASH_JOURNAL#*', 'SYSTEM#MERCHANT_ACCRUAL_INDEX',
        'OPERATIONAL_SETTINGS#MERCHANT_CORRECTIONS',
    )
    write = ('BRANCH#*', 'MERCHANT_PAYOUT#*', 'MERCHANT_CASHBOX#*', 'MERCHANT_CORRECTIONS#*')
    values = {
        'Merchants': {'GetItem': (), 'ConditionCheckItem': ()},
        'AccountDeletion': {action: ('ACCOUNT_LIFECYCLE#MERCHANT#*', 'BUSINESS_LIFECYCLE#MERCHANT#*')
                            for action in ('GetItem', 'ConditionCheckItem')},
        'MerchantPlatform': {'GetItem': platform, 'Query': platform, 'ConditionCheckItem': platform},
        'Orders': {'GetItem': ('ORDER#*',), 'ConditionCheckItem': ('ORDER#*',)},
        'Holds': {'GetItem': (), 'ConditionCheckItem': ()},
        'WaveOffers': {'GetItem': (), 'ConditionCheckItem': ()},
        'DispatchJobs': {'GetItem': ()},
        'Wallets': {'GetItem': merchant, 'ConditionCheckItem': merchant},
        'LedgerEntries': {'Query': merchant},
        'AuditLog': {'PutItem': ('date#*',)},
        'PlatformStaff': {'PutItem': ('SETTLEMENT_SCHEDULE_AUDIT#*',)},
        'WalletNotifications': {'PutItem': ('MERCHANT_PAYOUT_NOTICE#*',)},
    }
    if owner:
        preferences = ('MERCHANT_FINANCIAL_PUSH#*',)
        values['MerchantPlatform']['GetItem'] += preferences
        values['MerchantPlatform']['PutItem'] = write + preferences + ('MERCHANT_PAYOUT_DESTINATION#*',)
        values[SESSION] = {'GetItem': ('MERCHANT_FINANCIAL_SESSION#*',),
                           'ConditionCheckItem': ('MERCHANT_FINANCIAL_SESSION#*',)}
        values['PushDeviceTokens'] = {'GetItem': (), 'ConditionCheckItem': ()}
    else:
        cashbox_directory = ('MERCHANT_CASHBOXES#GLOBAL',)
        values['MerchantPlatform']['GetItem'] += ('MERCHANT_COLLECTION#*', 'MERCHANT_PAYOUT_REFERENCE#*') + cashbox_directory
        values['MerchantPlatform']['Query'] += ('MERCHANT_COLLECTION#*',) + cashbox_directory
        values['MerchantPlatform']['ConditionCheckItem'] += ('MERCHANT_COLLECTION#*',) + cashbox_directory
        values['MerchantPlatform']['PutItem'] = write + (
            'MERCHANT_SETTLEMENT#*', 'MERCHANT_COLLECTION#*', 'MERCHANT_PAYOUT_PAID#*', 'MERCHANT_PAYOUT_REFERENCE#*',
            'OPERATIONAL_SETTINGS#MERCHANT_CORRECTIONS',
        ) + cashbox_directory
        values['Merchants']['Scan'] = ()
        values['PlatformStaff'].update(GetItem=('EMPLOYEE#*',), ConditionCheckItem=('EMPLOYEE#*',), Scan=())
        values['Holds']['UpdateItem'] = ()
        values['Wallets']['UpdateItem'] = merchant
        values['LedgerEntries']['PutItem'] = merchant
    return [dynamodb(table, action, prefixes) for table, actions in values.items()
            for action, prefixes in actions.items()]


def build():
    reference = verification_template()
    template = {key: reference[key] for key in ('AWSTemplateFormatVersion', 'Rules', 'Conditions')}
    template['Description'] = 'Production merchant statements, cashbox accounting and payout workflows.'
    template['Parameters'] = reference['Parameters']
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'merchant-settlements/[a-f0-9]{64}[.]zip'
    resources = template['Resources'] = {}

    def add(key, kind, props, **extra):
        resources[key] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': props, **extra}

    identity = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())['identities']
    environment = {
        'ENVIRONMENT': 'production', 'PLATFORM_ENVIRONMENT': 'production',
        'PLATFORM_SESSION_POLICY': 'VALID_SESSION',
        'FINANCIAL_SESSION_TABLE': 'wizz-production-' + SESSION,
        'OTP_SECRET_ARN': ref('MerchantOtpSecret'),
        'WALLETS_TABLE': 'wizz-production-Wallets',
        'LEDGER_TABLE': 'wizz-production-LedgerEntries',
        'HOLDS_TABLE': 'wizz-production-Holds',
        'TOPUP_REQUESTS_TABLE': 'wizz-production-TopupRequests',
        'AUDIT_LOG_TABLE': 'wizz-production-AuditLog',
        'IDEMPOTENCY_KEYS_TABLE': 'wizz-production-IdempotencyKeys',
        'ORDERS_TABLE': 'wizz-production-Orders',
        'ACCOUNT_DELETION_TABLE': 'wizz-production-AccountDeletion',
        'STAFF_TABLE': 'wizz-production-PlatformStaff',
        'OFFER_JOURNEY_TABLE': 'wizz-production-OfferJourney',
        'DISPATCH_JOBS_TABLE': 'wizz-production-DispatchJobs',
        'DRIVER_LIVE_STATE_TABLE': 'wizz-production-DriverLiveState',
        'DRIVERS_TABLE': 'wizz-production-Drivers',
        'MERCHANTS_TABLE': 'wizz-production-Merchants',
        'WAVE_OFFERS_TABLE': 'wizz-production-WaveOffers',
        'DELIVERY_QUOTES_TABLE': 'wizz-production-DeliveryQuotes',
        'WALLET_LIFECYCLE_TABLE': 'wizz-production-WalletLifecycle',
        'WALLET_NOTIFICATIONS_TABLE': 'wizz-production-WalletNotifications',
        'MERCHANT_PAYOUT_NOTIFICATIONS_ENABLED': 'true',
        'MERCHANT_FINANCIAL_DEVICE_POLICY_ENABLED': 'true',
    }
    for label, pool in (('Owner', 'merchant'), ('Staff', 'admin')):
        name = NAME + '-' + label.lower()
        log = '/aws/lambda/' + name
        add(label + 'Log', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
            DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
        grants = permissions(label == 'Owner') + [
            allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
                  sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
            allow('cognito-idp:AdminGetUser', sub(
                'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + identity[pool]['poolId'])),
        ]
        if label == 'Owner':
            grants.append(allow('secretsmanager:GetSecretValue', ref('MerchantOtpSecret')))
        add(label + 'Role', 'AWS::IAM::Role', {
            'AssumeRolePolicyDocument': reference['Resources']['Role']['Properties']['AssumeRolePolicyDocument'],
            'Policies': [{'PolicyName': 'MerchantSettlements',
                          'PolicyDocument': {'Version': '2012-10-17', 'Statement': grants}}],
        })
        add(label + 'Function', 'AWS::Lambda::Function', {
            'FunctionName': name, 'Runtime': 'nodejs22.x', 'Handler': 'index.' + label.lower(),
            'Role': attr(label + 'Role', 'Arn'), 'Environment': {'Variables': environment},
            'MemorySize': 512, 'Timeout': 28, 'LoggingConfig': {'LogGroup': ref(label + 'Log')},
            'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
        })

    add('Api', 'AWS::ApiGateway::RestApi', {
        'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']},
    })
    parent_ids = {'': attr('Api', 'RootResourceId')}
    dependencies = []
    for label, (path, methods) in ROUTES.items():
        parent = ''
        for part in path.strip('/').split('/'):
            current = parent + '/' + part
            if current not in parent_ids:
                key = 'Resource' + label + str(len(parent_ids))
                add(key, 'AWS::ApiGateway::Resource', {
                    'RestApiId': ref('Api'), 'ParentId': parent_ids[parent], 'PathPart': part,
                })
                parent_ids[current] = ref(key)
            parent = current
        function = 'OwnerFunction' if label == 'Owner' else 'StaffFunction'
        for method in methods:
            key = label + method
            add(key, 'AWS::ApiGateway::Method', {
                'RestApiId': ref('Api'), 'ResourceId': parent_ids[path], 'HttpMethod': method,
                'AuthorizationType': 'NONE', 'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST',
                    'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
                               + '${' + function + '.Arn}/invocations')},
            })
            permission = key + 'Invoke'
            add(permission, 'AWS::Lambda::Permission', {
                'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com',
                'FunctionName': ref(function), 'SourceAccount': ref('AWS::AccountId'),
                'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'
                                 + method + path),
            })
            dependencies.extend([key, permission])
    add('Deployment', 'AWS::ApiGateway::Deployment', {'RestApiId': ref('Api')}, DependsOn=dependencies)
    stage = reference['Resources']['Stage']
    resources['Stage'] = stage
    template['Outputs'] = reference['Outputs']
    return template


def package(out):
    target = out / 'index.js'
    bundle = ROOT / 'merchant-settlements/bundle.cjs'
    subprocess.run(['node', str(bundle), str(bundle.with_name('index.cjs')), str(target)], cwd=REPO, check=True)
    artifact = out / 'merchant-settlements.zip'
    with ZipFile(artifact, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), target.read_bytes(), compress_type=ZIP_DEFLATED)
    return hashlib.sha256(artifact.read_bytes()).hexdigest()


if __name__ == '__main__':
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    (out / 'merchant-settlements.template.json').write_text(json.dumps(build(), separators=(',', ':')) + '\n')
    print(package(out))
