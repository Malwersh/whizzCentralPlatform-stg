"""Package the production merchant response worker with its order stream and retry rule."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import BUCKET, REPO, allow, attr, ref, sub, table
from prepare_order_financial_runtime import build as financial, dynamodb
from prepare_customer_delivery_quotes import leading

NAME = 'wizz-production-merchant-response'
RULE = NAME + '-due'
STREAM = 'arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-Orders/stream/*'


def package(output):
    entry = subprocess.check_output([
        str(REPO / 'backend/wallet-service/node_modules/.bin/esbuild'),
        'backend/wallet-service/src/merchantResponseRuntime.ts', '--bundle', '--platform=node',
        '--target=node22', '--format=cjs', '--keep-names', '--log-level=error',
    ], cwd=REPO)
    with ZipFile(output, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), entry, compress_type=ZIP_DEFLATED)


def build():
    base = financial()
    variables = {k: v for k, v in base['Resources']['Function']['Properties']['Environment']['Variables'].items()
                 if isinstance(v, str)}
    # Canonical serialization used by the order rollout validator.
    config = '{"accountId":"746727375268","region":"us-east-1","schemaVersion":1,"scopes":[]}'
    variables.update(STAGE='production', FINANCIAL_COD_ACCOUNT_ID='746727375268',
                     MERCHANT_RESPONSE_MODE='REQUIRED', FINANCE_GENERAL_RELEASE_MODE='REQUIRED',
                     FINANCE_ROLLOUT_CONFIG=config, FINANCE_ROLLOUT_SHA256=hashlib.sha256(config.encode()).hexdigest())
    condition = 'IsProductionAccount'
    log = '/aws/lambda/' + NAME
    logs = allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
                 sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*'))
    permissions = {
        'Orders': (('ORDER#*',), ['GetItem', 'ConditionCheckItem', 'UpdateItem']),
        'WalletLifecycle': (('MERCHANT_RESPONSE#*', 'MERCHANT_RESUME#*'), ['GetItem','ConditionCheckItem','PutItem','UpdateItem']),
        'Merchants': ((), ['GetItem','ConditionCheckItem','UpdateItem']),
        'DispatchJobs': ((), ['GetItem','ConditionCheckItem','UpdateItem']),
        'AccountDeletion': (('BUSINESS_LIFECYCLE#MERCHANT#*','ACCOUNT_LIFECYCLE#MERCHANT#*'), ['GetItem','ConditionCheckItem']),
        'Holds': ((), ['GetItem','ConditionCheckItem','PutItem','UpdateItem']),
        'OfferJourney': (('USER#*','BENEFIT_ORDER#*'), ['GetItem','ConditionCheckItem','PutItem']),
        'PlatformStaff': (('DELIVERY_BUDGET#*','DELIVERY_USAGE#*','DELIVERY_RESERVATION#*'), ['GetItem','ConditionCheckItem','PutItem']),
        'Wallets': (('WALLET#PLATFORM',), ['GetItem','ConditionCheckItem','UpdateItem']),
        'LedgerEntries': (('WALLET#PLATFORM',), ['PutItem']),
        'AuditLog': (('date#*',), ['PutItem']),
        'MerchantDiscounts': ((), ['GetItem','ConditionCheckItem','PutItem']),
        'PlatformDiscounts': ((), ['GetItem','ConditionCheckItem','PutItem']),
    }
    statements = [logs, *[dynamodb(name, action, keys) for name, (keys, actions) in permissions.items()
                          for action in actions],
        allow('dynamodb:Query', table('WalletLifecycle/index/ByDue'), leading('MERCHANT_RESPONSE')),
        allow(['dynamodb:DescribeStream','dynamodb:GetRecords','dynamodb:GetShardIterator','dynamodb:ListStreams'],
              sub(STREAM)),
    ]

    def resource(kind, properties, **extra):
        return {'Type': kind, 'Condition': condition, 'Properties': properties, **extra}

    resources = {
        'LogGroup': resource('AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
                             DeletionPolicy='Retain', UpdateReplacePolicy='Retain'),
        'Role': resource('AWS::IAM::Role', {
            'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [{
                'Effect': 'Allow', 'Action': 'sts:AssumeRole', 'Principal': {'Service': 'lambda.amazonaws.com'},
            }]},
            'Policies': [{'PolicyName': 'ProcessMerchantResponses', 'PolicyDocument': {
                'Version': '2012-10-17', 'Statement': statements,
            }}],
        }),
        'Worker': resource('AWS::Lambda::Function', {
            'FunctionName': NAME, 'Runtime': 'nodejs22.x', 'Handler': 'index.handler', 'Role': attr('Role','Arn'),
            'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
            'Environment': {'Variables': variables}, 'MemorySize': 512, 'Timeout': 55,
            'LoggingConfig': {'LogGroup': ref('LogGroup')},
        }),
        'Due': resource('AWS::Events::Rule', {
            'Name': RULE, 'ScheduleExpression': 'rate(1 minute)', 'State': 'ENABLED',
            'Targets': [{'Id': 'Worker', 'Arn': attr('Worker','Arn')}],
        }),
        'DuePermission': resource('AWS::Lambda::Permission', {
            'Action': 'lambda:InvokeFunction', 'Principal': 'events.amazonaws.com', 'FunctionName': ref('Worker'),
            'SourceArn': attr('Due','Arn'), 'SourceAccount': ref('AWS::AccountId'),
        }),
        'OrderInserts': resource('AWS::Lambda::EventSourceMapping', {
            'FunctionName': ref('Worker'), 'EventSourceArn': ref('OrdersStreamArn'), 'StartingPosition': 'LATEST',
            'Enabled': True, 'BatchSize': 10, 'BisectBatchOnFunctionError': True, 'MaximumRetryAttempts': 2,
            'FilterCriteria': {'Filters': [{'Pattern': json.dumps({
                'eventName': ['INSERT'],
                'dynamodb': {'NewImage': {'SK': {'S': ['META']}, 'merchantResponsePolicy': {'M': {'schemaVersion': {'N': ['1']}}}}},
            }, separators=(',', ':'))}]},
        }),
    }
    return {
        'AWSTemplateFormatVersion': '2010-09-09',
        'Description': 'Process merchant response deadlines against production orders and lifecycle records.',
        'Conditions': {condition: base['Conditions'][condition]},
        'Parameters': {
            'ExpectedAccountId': base['Parameters']['ExpectedAccountId'],
            'ArtifactKey': {'Type': 'String', 'AllowedPattern': 'merchant-response/[a-f0-9]{64}[.]zip'},
            'ArtifactVersion': {'Type': 'String', 'MinLength': 1},
            'OrdersStreamArn': {'Type': 'String', 'AllowedPattern':
                'arn:aws:dynamodb:us-east-1:746727375268:table/wizz-production-Orders/stream/[A-Za-z0-9_.:-]+'},
        },
        'Resources': resources,
    }


if __name__ == '__main__':
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    archive = output / 'merchant-response.zip'
    package(archive)
    (output / 'merchant-response.template.json').write_text(json.dumps(build(), indent=2) + '\n')
    print(hashlib.sha256(archive.read_bytes()).hexdigest())
