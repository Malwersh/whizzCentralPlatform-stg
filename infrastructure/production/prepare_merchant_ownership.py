"""Package the production restaurant ownership participant service and push worker."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import BUCKET, ROOT, REPO, allow, sub, table
from prepare_customer_home import leading
from prepare_merchant_financial_session import build as verification_template
from prepare_merchant_payout_notices import NAME as PAYOUT, build as worker_template
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-merchant-ownership'
NOTICES = NAME + '-notices'
OUTBOX = 'WalletNotifications'
PREFIX = 'OWNERSHIP_NOTICE#'
LIFECYCLE_KEYS = ('ACCOUNT_LIFECYCLE#MERCHANT#*', 'SUBJECT#MERCHANT#*')
ROUTE = 'ownership-transfer'


def attributes(fields):
    return {'ForAllValues:StringEquals': {'dynamodb:Attributes': fields.split()},
            'Null': {'dynamodb:Attributes': 'false'}}


def projected_transaction(fields, keys=()):
    conditions = {**attributes(fields), 'StringEquals': {'dynamodb:EnclosingOperation': 'TransactWriteItems'}}
    if keys:
        scope = leading(keys, 'StringLike')
        conditions.update({key: value for key, value in scope.items() if key != 'Null'})
        conditions['Null'].update(scope['Null'])
    return conditions


def api_build():
    template = json.loads(json.dumps(verification_template()).replace(
        'wizz-production-merchant-financial-session', NAME).replace('merchant-financial-session', ROUTE))
    template['Description'] = 'Ownership invitations and settlement phone verification for production restaurant owners.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'merchant-ownership/[a-f0-9]{64}[.]zip'
    r = template['Resources']
    del r['Function']['Properties']['Environment']['Variables']['FINANCIAL_SESSION_TABLE']
    policy = r['Role']['Properties']['Policies'][0]
    policy['PolicyName'] = 'MerchantOwnershipTransfer'
    base = [grant for grant in policy['PolicyDocument']['Statement'] if any(
        value in json.dumps(grant) for value in ('logs:CreateLogStream', 'cognito-idp:AdminGetUser', 'MerchantOtpSecret'))]
    base.extend([
        allow('dynamodb:GetItem', table('Merchants')),
        allow('dynamodb:Scan', table('Merchants'), attributes(
            'businessId brandId organizationId ownerId cognitoUserId status updatedAt deletionRequestId lifecycleStatus')),
        allow('dynamodb:UpdateItem', table('Merchants'), projected_transaction(
            'businessId orderIntakeTransferRequestId orderIntakeTransferExpiresAt ownerId cognitoUserId organizationId updatedAt deletionRequestId orderIntakeDeletionRequestId')),
        dynamodb('AccountDeletion', 'GetItem', LIFECYCLE_KEYS),
        dynamodb('AccountDeletion', 'ConditionCheckItem', LIFECYCLE_KEYS),
        dynamodb('PlatformStaff', 'GetItem', ('OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',)),
        dynamodb('PlatformStaff', 'ConditionCheckItem', ('OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING',)),
        dynamodb('MerchantPlatform', 'GetItem', ('ORGANIZATION#*', 'PERSON#*')),
        dynamodb('MerchantPlatform', 'ConditionCheckItem', ('ORGANIZATION#*', 'PERSON#*')),
        dynamodb('MerchantPlatform', 'Query', ('PERSON#*',)),
        allow('dynamodb:PutItem', table('MerchantPlatform'), projected_transaction(
            'pk sk requestId organizationId ownerId recipientId digest branchIds status version createdAt expiresAt acceptedAt agreementVersion cancelledAt declinedAt',
            ('ORGANIZATION#*', 'PERSON#*'))),
        allow('dynamodb:PutItem', table('MerchantPlatform'), projected_transaction(
            'pk sk kind requestId scopeDigest recipientId profileVersion challengeId codeHash status attempts version sentAt expiresAt windowStartedAt sendCount verifiedAt',
            ('ORGANIZATION#*',))),
        dynamodb(OUTBOX, 'PutItem', (PREFIX + '*',)),
    ])
    policy['PolicyDocument']['Statement'] = base
    for part in ('POST', 'POSTInvoke'):
        r[part]['Properties'] = dict(r[part]['Properties'])
    r['GET'] = json.loads(json.dumps(r['POST']).replace('"HttpMethod": "POST"', '"HttpMethod": "GET"'))
    r['GETInvoke'] = json.loads(json.dumps(r['POSTInvoke']).replace('/POST/auth/', '/GET/auth/'))
    r['Deployment']['DependsOn'] += ['GET', 'GETInvoke']
    return template


def notices_build():
    template = json.loads(json.dumps(worker_template()).replace(PAYOUT, NOTICES))
    template['Description'] = 'Production restaurant ownership push delivery and recovery.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'merchant-ownership-notices/[a-f0-9]{64}[.]zip'
    r = template['Resources']
    policy = r['Role']['Properties']['Policies'][0]
    policy['PolicyName'] = 'MerchantOwnershipNotices'
    statements = [grant for grant in policy['PolicyDocument']['Statement'] if not any(
        tag in json.dumps(grant) for tag in ('MERCHANT_PAYOUT', 'MERCHANT_FINANCIAL_PUSH', 'table/wizz-production-Merchants',
                                            'table/wizz-production-AccountDeletion', 'index/PendingDelivery'))]
    update = dynamodb(OUTBOX, 'UpdateItem', (PREFIX + '*',))
    del update['Condition']['StringEquals']
    statements.extend([
        update,
        allow('dynamodb:Query', table(OUTBOX + '/index/PendingDelivery'), leading(['OWNERSHIP_PENDING'])),
        dynamodb('MerchantPlatform', 'GetItem', ('ORGANIZATION#*',)),
        dynamodb('AccountDeletion', 'GetItem', LIFECYCLE_KEYS),
    ])
    policy['PolicyDocument']['Statement'] = statements
    env = r['Worker']['Properties']['Environment']['Variables']
    env['OWNERSHIP_NOTICE_STREAM_ARN'] = env.pop('PAYOUT_NOTICE_STREAM_ARN')
    r['RetryTick']['Properties']['Targets'][0]['Id'] = 'MerchantOwnershipNotices'
    r['OutboxSource']['Properties']['FilterCriteria'] = {'Filters': [{'Pattern': json.dumps({
        'eventName': ['INSERT'], 'dynamodb': {'Keys': {'eventId': {'S': [{'prefix': PREFIX}]}},
            'NewImage': {'recipientApp': {'S': ['merchant']}, 'deliveryStatus': {'S': ['OWNERSHIP_PENDING']}}}
    })}]}
    return template


def package(out, name, entry, template):
    tool = REPO / 'backend/wallet-service/node_modules/.bin/esbuild'
    deps = ROOT / 'driver-review/node_modules'
    bundle = subprocess.check_output([str(tool), str(ROOT / 'merchant-ownership' / entry),
        '--bundle', '--platform=node', '--target=node22', '--format=cjs', '--log-level=error',
        '--external:@aws-sdk/*'], cwd=REPO, env={**os.environ, 'NODE_PATH': str(deps)})
    artifact = out / (name + '.zip')
    with ZipFile(artifact, 'w', compression=ZIP_DEFLATED) as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), bundle, compress_type=ZIP_DEFLATED)
    (out / (name + '.template.json')).write_text(json.dumps(template, separators=(',', ':')) + '\n')
    print(name, hashlib.sha256(artifact.read_bytes()).hexdigest())


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    package(out, 'merchant-ownership', 'index.cjs', api_build())
    package(out, 'merchant-ownership-notices', 'notice-worker.cjs', notices_build())
