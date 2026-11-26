"""Prepare the isolated order-financial Lambda and its scoped acceptance policy."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAME = 'wizz-production-order-financial'
MODE = 'EnabledProductionOrderHost'
GENERAL_MODE = 'GeneralProductionOrderHost'


def dynamodb(role, action, keys=()):
    condition = {}
    if keys:
        condition['ForAllValues:StringLike'] = {'dynamodb:LeadingKeys': list(keys)}
        condition['Null'] = {'dynamodb:LeadingKeys': 'false'}
    if action in ('PutItem', 'UpdateItem', 'DeleteItem'):
        condition['StringEquals'] = {'dynamodb:EnclosingOperation': 'TransactWriteItems'}
    return {
        'Effect': 'Allow',
        'Action': 'dynamodb:' + action,
        'Resource': {'Fn::Sub': 'arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-' + role},
        **({'Condition': condition} if condition else {}),
    }


def build():
    template = json.loads((ROOT / 'driver-wallet.template.json').read_text())
    template['Description'] = 'Private production financial cancellation and driver unassignment for production orders.'
    parameters = template['Parameters']
    parameters['ArtifactKey']['AllowedPattern'] = r'order-financial/[a-f0-9]{64}\.zip'
    del parameters['WalletCreationEnabled']
    parameters.update({
        'HostMode': {'Type': 'String', 'Default': 'OFF', 'AllowedValues': ['OFF', 'SCOPED', 'GENERAL']},
        'RolloutConfig': {'Type': 'String', 'Default': '{}', 'NoEcho': True},
        'RolloutSha256': {'Type': 'String', 'Default': '', 'AllowedPattern': r'^(?:[a-f0-9]{64})?$'},
    })
    template['Conditions'][MODE] = {'Fn::And': [
        {'Condition': 'IsProductionAccount'},
        {'Fn::Not': [{'Fn::Equals': [{'Ref': 'HostMode'}, 'OFF']}]},
    ]}
    template['Conditions'][GENERAL_MODE] = {'Fn::And': [
        {'Condition': 'IsProductionAccount'},
        {'Fn::Equals': [{'Ref': 'HostMode'}, 'GENERAL']},
    ]}

    resources = template['Resources']
    log_group = '/aws/lambda/' + NAME
    resources['LogGroup']['Properties']['LogGroupName'] = log_group
    logs = {
        'Effect': 'Allow',
        'Action': ['logs:CreateLogStream', 'logs:PutLogEvents'],
        'Resource': {'Fn::Sub': 'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log_group + ':*'},
    }
    resources['Role']['Properties']['Policies'] = [{
        'PolicyName': 'WriteOrderFinancialLogs',
        'PolicyDocument': {'Version': '2012-10-17', 'Statement': [logs]},
    }]

    order = ('ORDER#*',)
    driver_wallet = ('WALLET#DRIVER#*',)
    campaign = ('DELIVERY_BUDGET#*', 'DELIVERY_USAGE#*', 'DELIVERY_RESERVATION#*')
    settings = ('OPERATIONAL_SETTINGS#ORDER_EXCEPTION_CASES', 'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS')
    benefit = ('BENEFIT_ORDER#*', 'USER#*')
    hold_lifecycle = ('FCH:*', 'FH:*')
    case_pointer = ('EXCEPTION_CASE#*',)
    common = {
        'Orders': (order, ('GetItem', 'ConditionCheckItem', 'UpdateItem')),
        'Holds': ((), ('GetItem', 'ConditionCheckItem', 'PutItem', 'UpdateItem')),
        'Wallets': (driver_wallet, ('GetItem', 'ConditionCheckItem', 'UpdateItem')),
        'LedgerEntries': (driver_wallet, ('PutItem',)),
        'AuditLog': (('date#*',), ('PutItem',)),
        'DispatchJobs': ((), ('GetItem', 'ConditionCheckItem', 'UpdateItem')),
        'WaveOffers': ((), ('GetItem', 'ConditionCheckItem')),
        'DriverLiveState': ((), ('GetItem', 'ConditionCheckItem', 'UpdateItem')),
        'Drivers': ((), ('GetItem', 'ConditionCheckItem')),
        'Merchants': ((), ('GetItem', 'ConditionCheckItem')),
        'AccountDeletion': ((
            'ACCOUNT_LIFECYCLE#DRIVER#*', 'ACCOUNT_LIFECYCLE#MERCHANT#*',
            'BUSINESS_LIFECYCLE#MERCHANT#*',
        ), ('ConditionCheckItem',)),
        'OfferJourney': (benefit, ('GetItem', 'PutItem')),
    }
    statements = [
        dynamodb(role, action, keys)
        for role, (keys, actions) in common.items()
        for action in actions
    ]
    statements.extend([
        dynamodb('PlatformStaff', 'GetItem', campaign + settings),
        dynamodb('PlatformStaff', 'ConditionCheckItem', campaign + settings),
        dynamodb('PlatformStaff', 'PutItem', campaign),
        dynamodb('WalletLifecycle', 'GetItem', hold_lifecycle + case_pointer),
        dynamodb('WalletLifecycle', 'ConditionCheckItem', hold_lifecycle + case_pointer),
        dynamodb('WalletLifecycle', 'UpdateItem', hold_lifecycle),
        dynamodb('WalletLifecycle', 'PutItem', case_pointer + ('CA:*:EVENT',)),
    ])
    identities = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())['identities']
    statements.append({
        'Effect': 'Allow',
        'Action': 'cognito-idp:AdminGetUser',
        'Resource': [
            {'Fn::Sub': 'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + identities[role]['poolId']}
            for role in ('driver', 'merchant', 'customer')
        ],
    })
    resources['Role']['Properties']['Policies'].append({'Fn::If': [
        MODE,
        {'PolicyName': 'OrderFinancialTransactions', 'PolicyDocument': {'Version': '2012-10-17', 'Statement': statements}},
        {'Ref': 'AWS::NoValue'},
    ]})

    base_env = json.loads((ROOT / 'wallet-receipt-runtime.json').read_text())['environment']
    variables = {
        name: value for name, value in base_env.items() if name in {
            'ENVIRONMENT', 'PLATFORM_ENVIRONMENT', 'WALLETS_TABLE', 'LEDGER_TABLE', 'HOLDS_TABLE',
            'TOPUP_REQUESTS_TABLE', 'AUDIT_LOG_TABLE', 'IDEMPOTENCY_KEYS_TABLE', 'ACCOUNT_DELETION_TABLE',
            'WALLET_LIFECYCLE_TABLE', 'ORDERS_TABLE', 'STAFF_TABLE', 'MERCHANTS_TABLE', 'DRIVERS_TABLE',
        }
    }
    for role, binding in identities.items():
        variables[role.upper() + '_USER_POOL_ID'] = binding['poolId']
        variables[role.upper() + '_CLIENT_ID'] = binding['clientId']
    variables.update({
        'DISPATCH_JOBS_TABLE': 'wizz-production-DispatchJobs',
        'WAVE_OFFERS_TABLE': 'wizz-production-WaveOffers',
        'DRIVER_LIVE_STATE_TABLE': 'wizz-production-DriverLiveState',
        'OFFER_JOURNEY_TABLE': 'wizz-production-OfferJourney',
        'DELIVERY_QUOTES_TABLE': 'wizz-production-DeliveryQuotes',
        'FINANCIAL_ORDER_HOST_MODE': {'Ref': 'HostMode'},
        'FINANCE_ROLLOUT_CONFIG': {'Ref': 'RolloutConfig'},
        'FINANCE_ROLLOUT_SHA256': {'Ref': 'RolloutSha256'},
        'FINANCIAL_DISPATCH_MODE': {'Fn::If': [MODE, 'REQUIRED', 'OFF']},
        'FINANCIAL_COD_ASSIGNMENTS_MODE': {'Fn::If': [MODE, 'REQUIRED', 'OFF']},
        'FINANCIAL_DELIVERY_FUNDING_MODE': 'REQUIRED',
        'FINANCIAL_SETTLEMENT_MODEL': 'FULL_CASH_AT_DELIVERY_V1',
        'DELIVERY_OPERATIONS_MODE': 'CENTRAL',
        'FINANCE_GENERAL_RELEASE_MODE': {'Fn::If': [GENERAL_MODE, 'REQUIRED', 'OFF']},
        'FINANCIAL_OFFER_TTL_SECONDS': '60',
        'FINANCIAL_POSITION_MAX_AGE_SECONDS': '120',
    })
    config = resources['Function']['Properties']
    config.update(FunctionName=NAME, Handler='index.financialAcceptanceHandler', MemorySize=256, Timeout=30)
    config['Environment']['Variables'] = variables
    return template


if __name__ == '__main__':
    (ROOT / 'order-financial-runtime.template.json').write_text(json.dumps(build(), indent=2) + '\n')
