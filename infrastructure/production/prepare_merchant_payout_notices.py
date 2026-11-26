"""Build the production merchant payout notification worker using the staging workflow."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import BUCKET, REPO, allow, attr, ref, sub, table
from prepare_dispatch_worker import build as dispatch_template
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-merchant-payout-notices'


def build():
    reference = dispatch_template()
    condition = 'IsProductionAccount'
    resources = {}

    def add(key, kind, properties, **extra):
        resources[key] = {'Type': kind, 'Condition': condition, 'Properties': properties, **extra}

    prefix = 'MERCHANT_PAYOUT_NOTICE#*'
    log = '/aws/lambda/' + NAME
    add('LogGroup', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    add('FailedEvents', 'AWS::SQS::Queue', {
        'QueueName': NAME + '-failed-events', 'MessageRetentionPeriod': 1209600, 'SqsManagedSseEnabled': True,
    }, DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    update = dynamodb('WalletNotifications', 'UpdateItem', (prefix,))
    del update['Condition']['StringEquals']
    add('Role', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': reference['Resources']['Role']['Properties']['AssumeRolePolicyDocument'],
        'Policies': [{'PolicyName': 'MerchantPayoutNotices', 'PolicyDocument': {
            'Version': '2012-10-17', 'Statement': [
                allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
                      sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
                allow(['dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator',
                       'dynamodb:ListStreams'], ref('OutboxStreamArn')),
                allow('dynamodb:Query', table('WalletNotifications/index/PendingDelivery')),
                allow('dynamodb:Query', table('PushDeviceTokens/index/SubjectIdIndex')),
                dynamodb('PushDeviceTokens', 'GetItem'),
                dynamodb('Merchants', 'GetItem'),
                dynamodb('AccountDeletion', 'GetItem',
                         ('ACCOUNT_LIFECYCLE#MERCHANT#*', 'BUSINESS_LIFECYCLE#MERCHANT#*')),
                dynamodb('MerchantPlatform', 'GetItem', ('MERCHANT_FINANCIAL_PUSH#*', 'MERCHANT_PAYOUT#*')),
                allow('secretsmanager:GetSecretValue', ref('FirebaseProductionSecretArn')),
                allow('sqs:SendMessage', attr('FailedEvents', 'Arn')),
                update,
            ],
        }}],
    })
    add('Worker', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Handler': 'index.handler', 'Runtime': 'nodejs22.x', 'MemorySize': 512, 'Timeout': 55,
        'Role': attr('Role', 'Arn'), 'DeadLetterConfig': {'TargetArn': attr('FailedEvents', 'Arn')},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
        'Environment': {'Variables': {
            'STAGE': 'production', 'PAYOUT_NOTICE_STREAM_ARN': ref('OutboxStreamArn'),
            'FIREBASE_ADMIN_SA_SECRET_ID': ref('FirebaseProductionSecretArn'),
            'FIREBASE_PRODUCTION_PROJECT_ID': 'wizz-business-app',
            'FIREBASE_PRODUCTION_SERVICE_ACCOUNT_EMAIL': ref('FirebaseProductionServiceAccountEmail'),
        }},
        'LoggingConfig': {'LogGroup': ref('LogGroup')},
    })
    add('OutboxSource', 'AWS::Lambda::EventSourceMapping', {
        'EventSourceArn': ref('OutboxStreamArn'), 'FunctionName': ref('Worker'), 'StartingPosition': 'LATEST',
        'BatchSize': 5, 'Enabled': True, 'FunctionResponseTypes': ['ReportBatchItemFailures'],
        'FilterCriteria': {'Filters': [{'Pattern': json.dumps({'dynamodb': {
            'Keys': {'eventId': {'S': [{'prefix': prefix.removesuffix('*')}]}},
            'NewImage': {'type': {'S': ['merchant_payout_updated']}, 'recipientApp': {'S': ['merchant']},
                         'attempts': {'N': ['0']}},
        }})}]},
        'MaximumRetryAttempts': 5,
        'DestinationConfig': {'OnFailure': {'Destination': attr('FailedEvents', 'Arn')}},
    })
    add('RetryTick', 'AWS::Events::Rule', {
        'Name': NAME, 'ScheduleExpression': 'rate(1 minute)', 'State': 'ENABLED',
        'Targets': [{'Id': 'PayoutNotices', 'Arn': attr('Worker', 'Arn')}],
    })
    add('TickInvoke', 'AWS::Lambda::Permission', {
        'Action': 'lambda:InvokeFunction', 'FunctionName': ref('Worker'), 'Principal': 'events.amazonaws.com',
        'SourceAccount': ref('AWS::AccountId'), 'SourceArn': attr('RetryTick', 'Arn'),
    })
    return {
        'AWSTemplateFormatVersion': '2010-09-09',
        'Description': 'Production restaurant payout notifications and scheduled delivery recovery.',
        'Conditions': reference['Conditions'],
        'Parameters': {
            'ArtifactKey': {'Type': 'String', 'AllowedPattern': 'merchant-payout-notices/[a-f0-9]{64}[.]zip'},
            'ArtifactVersion': {'Type': 'String', 'MinLength': 1},
            'OutboxStreamArn': {'Type': 'String', 'AllowedPattern':
                               r'arn:aws:dynamodb:us-east-1:746727375268:table/wizz-production-WalletNotifications/stream/[A-Za-z0-9_.:-]+'},
            **{key: value for key, value in reference['Parameters'].items() if key.startswith('FirebaseProduction')},
        },
        'Resources': resources,
        'Outputs': {'WorkerArn': {'Condition': condition, 'Value': attr('Worker', 'Arn')}},
    }


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    bundle = subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),
        'infrastructure/production/merchant-payout-notices.cjs', '--bundle', '--platform=node', '--target=node22',
        '--format=cjs', '--log-level=error', '--external:@aws-sdk/*',
    ], cwd=REPO)
    artifact = out/'merchant-payout-notices.zip'
    with ZipFile(artifact, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), bundle, compress_type=ZIP_DEFLATED)
    (out/'merchant-payout-notices.template.json').write_text(json.dumps(build(), separators=(',', ':')) + '\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
