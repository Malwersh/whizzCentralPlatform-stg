"""Package the production worker for merchant shared-discount invitations."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import REPO, allow, table
from prepare_merchant_payout_notices import NAME as PAYOUT, build as payout_template
from prepare_order_financial_runtime import dynamodb
from prepare_customer_home import leading

NAME = 'wizz-production-merchant-commercial-notices'
PREFIX = 'COMMERCIAL_SHARING_NOTICE#'


def build():
    template = json.loads(json.dumps(payout_template()).replace(PAYOUT, NAME))
    template['Description'] = 'Production merchant shared-discount invitation notifications and retry recovery.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'merchant-commercial-notices/[a-f0-9]{64}[.]zip'
    resources = template['Resources']
    policy = resources['Role']['Properties']['Policies'][0]
    policy['PolicyName'] = 'MerchantCommercialNotices'
    statements = policy['PolicyDocument']['Statement']
    inherited = [
        item for item in statements
        if not any(value in json.dumps(item) for value in
                   ('MERCHANT_PAYOUT_NOTICE#', 'MERCHANT_FINANCIAL_PUSH#', 'index/PendingDelivery'))
    ]
    inherited.extend([
        dynamodb('PlatformStaff', 'GetItem', ('DISCOUNT_FUNDING#*', 'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS')),
        dynamodb('MerchantPlatform', 'GetItem', ('BRANCH#*',)),
        dynamodb('MerchantPlatform', 'Query', ('BRANCH#*',)),
        allow('dynamodb:Query', table('WalletNotifications/index/PendingDelivery'), leading(['COMMERCIAL_PENDING'])),
    ])
    identity = json.loads((REPO / 'infrastructure/production/wallet-identity-bindings.json').read_text())
    pool = identity['identities']['merchant']['poolId']
    inherited.append(allow('cognito-idp:AdminGetUser', {'Fn::Sub':
        'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + pool}))
    update = dynamodb('WalletNotifications', 'UpdateItem', (PREFIX + '*',))
    del update['Condition']['StringEquals']
    inherited.append(update)
    policy['PolicyDocument']['Statement'] = inherited
    env = resources['Worker']['Properties']['Environment']['Variables']
    env['COMMERCIAL_NOTICE_STREAM_ARN'] = env.pop('PAYOUT_NOTICE_STREAM_ARN')
    resources['RetryTick']['Properties']['Targets'][0]['Id'] = 'CommercialNotices'
    stream = resources['OutboxSource']['Properties']
    stream['FilterCriteria']['Filters'][0]['Pattern'] = json.dumps({'eventName': ['INSERT'], 'dynamodb': {
        'Keys': {'eventId': {'S': [{'prefix': PREFIX}]}},
        'NewImage': {'type': {'S': ['commercial_sharing_requested']}, 'recipientApp': {'S': ['merchant']},
                     'deliveryStatus': {'S': ['COMMERCIAL_PENDING']}},
    }})
    return template


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    bundle = subprocess.check_output([
        str(REPO / 'backend/wallet-service/node_modules/.bin/esbuild'),
        'infrastructure/production/merchant-commercial-notices.cjs', '--bundle', '--platform=node', '--target=node22',
        '--format=cjs', '--log-level=error', '--external:@aws-sdk/*',
    ], cwd=REPO)
    artifact = out / 'merchant-commercial-notices.zip'
    with ZipFile(artifact, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), bundle, compress_type=ZIP_DEFLATED)
    (out / 'merchant-commercial-notices.template.json').write_text(json.dumps(build(), separators=(',', ':')) + '\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
