"""Package only return and financial notices from the isolated production outbox."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import REPO, table
from prepare_merchant_payout_notices import build as build_notification_worker
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-order-return-notices'
EVENTS = {'RETURN_TASK_NOTICE#': ('driver_return_task_updated',),
          'EXCEPTION_FINANCIAL_NOTICE#': ('driver_exception_financial_updated','merchant_exception_financial_updated')}


def build():
    template = build_notification_worker()
    template['Description'] = 'Verified production return notices for drivers and merchants, with delivery retries.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'order-return-notices/[a-f0-9]{64}[.]zip'
    resources = template['Resources']
    resources['LogGroup']['Properties']['LogGroupName'] = '/aws/lambda/' + NAME
    resources['FailedEvents']['Properties']['QueueName'] = NAME + '-failed-events'
    policy = resources['Role']['Properties']['Policies'][0]
    policy['PolicyName'] = 'OrderReturnNotices'
    statements = policy['PolicyDocument']['Statement']
    statements[0]['Resource']['Fn::Sub'] = (
        'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/' + NAME + ':*')
    for index, statement in enumerate(statements):
        resource = statement.get('Resource')
        if resource == table('WalletNotifications'):
            update = dynamodb('WalletNotifications','UpdateItem',tuple(prefix+'*' for prefix in EVENTS))
            del update['Condition']['StringEquals']
            statements[index] = update
        if resource == table('AccountDeletion'):
            statements[index] = dynamodb('AccountDeletion','GetItem',
                ('ACCOUNT_LIFECYCLE#DRIVER#*','ACCOUNT_LIFECYCLE#MERCHANT#*','BUSINESS_LIFECYCLE#MERCHANT#*'))
        if resource == table('MerchantPlatform'):
            statements[index] = dynamodb('MerchantPlatform','GetItem',('MERCHANT_FINANCIAL_PUSH#*',))
    statements.append(dynamodb('Drivers','GetItem'))
    worker = resources['Worker']['Properties']
    worker['FunctionName'] = NAME
    env = worker['Environment']['Variables']
    env['RETURN_NOTICE_STREAM_ARN'] = env.pop('PAYOUT_NOTICE_STREAM_ARN')
    resources['OutboxSource']['Properties']['FilterCriteria'] = {'Filters': [
        {'Pattern': json.dumps({'eventName': ['INSERT'], 'dynamodb': {
            'Keys': {'eventId': {'S': [{'prefix': prefix}]}},
            'NewImage': {'type': {'S': types}, 'attempts': {'N': ['0']}},
        }})} for prefix, types in EVENTS.items()
    ]}
    tick = resources['RetryTick']['Properties']
    tick['Name'] = NAME
    tick['Targets'][0]['Id'] = 'OrderReturnNotices'
    return template


def package(output):
    source=subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),
        'infrastructure/production/order-return-notices.cjs','--bundle','--platform=node','--target=node22',
        '--format=cjs','--log-level=error','--external:@aws-sdk/*',
    ],cwd=REPO)
    with ZipFile(output,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),source,compress_type=ZIP_DEFLATED)
    return hashlib.sha256(output.read_bytes()).hexdigest()


if __name__ == '__main__':
    directory=Path(sys.argv[1])
    directory.mkdir(parents=True,exist_ok=True)
    (directory/'order-return-notices.template.json').write_text(json.dumps(build(),separators=(',',':'))+'\n')
    print(package(directory/'order-return-notices.zip'))
