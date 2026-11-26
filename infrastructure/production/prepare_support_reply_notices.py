"""Build the dedicated production worker for customer support replies."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import REPO, table
from prepare_merchant_payout_notices import build as build_notification_worker
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-support-reply-notices'


def build():
    template = build_notification_worker()
    template['Description'] = 'Customer support and complaint push notifications with production delivery retries.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'support-reply-notices/[a-f0-9]{64}[.]zip'
    r = template['Resources']
    r['LogGroup']['Properties']['LogGroupName'] = '/aws/lambda/' + NAME
    r['FailedEvents']['Properties']['QueueName'] = NAME + '-failed-events'
    policy = r['Role']['Properties']['Policies'][0]
    policy['PolicyName'] = 'SupportReplyNotices'
    statements = policy['PolicyDocument']['Statement']
    statements[0]['Resource']['Fn::Sub'] = (
        'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/' + NAME + ':*')
    for i, statement in enumerate(statements):
        resource = statement.get('Resource', {})
        if resource == table('Merchants'):
            statements[i] = dynamodb('Customers', 'GetItem')
        if resource == table('MerchantPlatform'):
            statements[i] = dynamodb('SupportChatSessions', 'GetItem')
        if resource == table('AccountDeletion'):
            statements[i] = dynamodb('AccountDeletion', 'GetItem', ('ACCOUNT_LIFECYCLE#CUSTOMER#*',))
        if resource == table('WalletNotifications'):
            statements[i] = dynamodb('WalletNotifications', 'UpdateItem', ('CN:*',))
            del statements[i]['Condition']['StringEquals']
    statements.append(dynamodb('Holds', 'GetItem'))
    worker = r['Worker']['Properties']
    worker['FunctionName'] = NAME
    environment = worker['Environment']['Variables']
    environment['SUPPORT_NOTICE_STREAM_ARN'] = environment.pop('PAYOUT_NOTICE_STREAM_ARN')
    r['OutboxSource']['Properties']['FilterCriteria'] = {'Filters': [{'Pattern': json.dumps({
        'eventName': ['INSERT'],
        'dynamodb': {'Keys': {'eventId': {'S': [{'prefix': 'CN:'}]}},
                     'NewImage': {'type': {'S': ['support_reply', 'order_complaint_updated']},
                                  'recipientApp': {'S': ['user']},
                                  'attempts': {'N': ['0']}}},
    })}]}
    tick = r['RetryTick']['Properties']
    tick['Name'] = NAME
    tick['Targets'][0]['Id'] = 'SupportReplyNotices'
    return template


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    bundle = subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),
        'infrastructure/production/support-reply-notices.cjs',
        '--bundle', '--platform=node', '--target=node22', '--format=cjs', '--log-level=error', '--external:@aws-sdk/*',
    ], cwd=REPO)
    artifact = out/'support-reply-notices.zip'
    with ZipFile(artifact, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), bundle, compress_type=ZIP_DEFLATED)
    (out/'support-reply-notices.template.json').write_text(json.dumps(build(), separators=(',', ':')) + '\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
