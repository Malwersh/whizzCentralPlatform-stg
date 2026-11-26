"""Build isolated production merchant directory and application review."""
import hashlib
import io
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

from prepare_customer_storefront import BUCKET, ROOT, REPO, allow, attr, ref, sub, table
from prepare_customer_home import leading

NAME = 'wizz-production-merchant-directory'
ROOT_PATH = '/staff/merchants'
ROUTES = {
    ROOT_PATH + '/directory': 'GET',
    ROOT_PATH + '/branch': 'GET',
    ROOT_PATH + '/applications': 'GET',
    ROOT_PATH + '/applications/review': 'POST',
    ROOT_PATH + '/application-asset': 'GET',
    ROOT_PATH + '/control': 'POST',
    ROOT_PATH + '/lifecycle': 'GET',
    ROOT_PATH + '/lifecycle/decision': 'POST',
}


def package():
    search = [ROOT / 'driver-review' / 'node_modules', REPO / 'backend/wallet-service/node_modules']
    bundle = subprocess.check_output([
        str(search[1] / '.bin/esbuild'), str(ROOT / 'merchant-directory/index.cjs'), '--bundle',
        '--platform=node', '--target=node22', '--format=cjs', '--log-level=error',
        '--external:@aws-sdk/client-*', '--external:@aws-sdk/lib-dynamodb',
    ], cwd=REPO, env={**os.environ, 'NODE_PATH': os.pathsep.join(map(str, search))})
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(zipfile.ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), bundle, compress_type=zipfile.ZIP_DEFLATED)
    return data.getvalue()


def build():
    base = json.loads((ROOT / 'storage-auth.template.json').read_text())
    template = {key: value for key, value in base.items() if key not in ('Resources', 'Outputs')}
    template['Description'] = 'Production merchant directory, documents and onboarding application decisions.'
    template['Parameters'].update({
        'ArtifactKey': {'Type': 'String', 'AllowedPattern': 'merchant-directory/[a-f0-9]{64}[.]zip'},
        'ArtifactVersion': {'Type': 'String', 'MinLength': 1},
    })
    resources = template['Resources'] = {}

    def add(name, kind, props, **attrs):
        resources[name] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': props, **attrs}
        return ref(name)

    log_name = '/aws/lambda/' + NAME
    log = add('LogGroup', 'AWS::Logs::LogGroup', {'LogGroupName': log_name, 'RetentionInDays': 90},
              DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    get, put, check = 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:ConditionCheckItem'
    scope = lambda keys: leading(keys, 'StringLike')

    def attributes(fields):
        return {'ForAllValues:StringEquals': {'dynamodb:Attributes': fields.split()},
                'Null': {'dynamodb:Attributes': 'false'}}

    transaction = {'StringEquals': {'dynamodb:EnclosingOperation': 'TransactWriteItems'}}
    pool = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())['identities']['admin']['poolId']
    statements = [
        allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log_name + ':*')),
        allow([get, check], table('PlatformStaff'), scope(['EMPLOYEE#*', 'OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING'])),
        allow(get, table('PlatformStaff'), scope(['COMMERCIAL_AGREEMENT#*'])),
        allow(put, table('PlatformStaff'), {**leading(['AUDIT']), **transaction}),
        allow([get, 'dynamodb:Query', check], table('MerchantPlatform'), leading(['REVIEW#MERCHANT'])),
        allow([get, check], table('MerchantPlatform'), scope(['PERSON#*', 'ORGANIZATION#*'])),
        allow(get, table('MerchantPlatform'), scope(['BRANCH#*', 'COMMERCIAL_AGREEMENT#*'])),
        allow(put, table('MerchantPlatform'), {**scope(['REVIEW#MERCHANT', 'PERSON#*']), **transaction}),
        allow(put, table('MerchantPlatform'), {
            **scope(['ORGANIZATION#*']), **transaction,
            **attributes('pk sk kind status requestId recipientId scopeDigest profileVersion proofVersion version decidedAt decidedBy'),
            'Null': {'dynamodb:LeadingKeys': 'false', 'dynamodb:Attributes': 'false'},
        }),
        allow('dynamodb:UpdateItem', table('MerchantPlatform'), {
            **scope(['ORGANIZATION#*']), **transaction,
            **attributes('pk sk status version reviewerId rejectedAt requestId expiresAt'),
            'Null': {'dynamodb:LeadingKeys': 'false', 'dynamodb:Attributes': 'false'},
        }),
        allow(check, table('AccountDeletion'), scope(['ACCOUNT_LIFECYCLE#MERCHANT#*', 'SUBJECT#MERCHANT#*'])),
        allow([get, 'dynamodb:Scan'], table('Merchants')),
        allow('dynamodb:Scan', table('MerchantPlatform'),
              attributes('pk sk requestId organizationId branchIds status expiresAt createdAt agreementVersion')),
        allow('dynamodb:Scan', table('AccountDeletion'),
              attributes('pk sk requestId actorType scope status blockers createdAt updatedAt')),
        allow('dynamodb:Query', table('MerchantPlatform'),
              scope(['BRANCH#*', 'MERCHANT_PAYOUT#*', 'MERCHANT_CORRECTIONS#*'])),
        allow([get, check], table('Wallets'), scope(['WALLET#MERCHANT#*'])),
        *[allow('dynamodb:Scan', table(name), attributes(fields)) for name, fields in {
            'Orders': 'PK SK storeId businessId restaurantId status orderStatus',
            'Holds': 'orderId sk walletId status',
            'TopupRequests': 'topupId sk walletId status',
            'IdempotencyKeys': 'idempotencyKey sk transferId sourceWalletId recipientWalletId status enabled ownerId',
        }.items()],
        allow(put, table('Merchants'), transaction),
        allow('dynamodb:UpdateItem', table('Merchants'), {
            **transaction,
            'ForAllValues:StringEquals': {'dynamodb:Attributes': [
                'businessId', 'ownerId', 'cognitoUserId', 'regionId', 'status', 'isActive',
                'onboardingSchemaVersion', 'onboardingComplete', 'platformSuspended', 'ordersBlocked',
                'acceptingOrders', 'onlineStatus', 'operatingStatus', 'updatedAt', 'lastStatusUpdate',
                'orderPauseId', 'ordersPausedUntil', 'deletionRequestId', 'isDeleted', 'deletedAt',
                'lifecycleStatus', 'orderIntakeDeletionRequestId', 'orderIntakeTransferRequestId',
                'orderIntakeTransferExpiresAt', 'platformControlUpdatedAt', 'platformControlUpdatedBy',
                'platformControlReason',
            ]},
            'Null': {'dynamodb:Attributes': 'false'},
        }),
        allow(check, table('AccountDeletion'), scope(['BUSINESS_LIFECYCLE#MERCHANT#*'])),
        allow([get, check], [table('Regions'), table('RegionsDerived')]),
        allow('dynamodb:Query', [table('RegionIndex'), table('RegionIndex/index/h3-index')]),
        allow('s3:GetObject', sub('arn:${AWS::Partition}:s3:::wizz-production-merchant-onboarding-746727375268/persons/*/drafts/*')),
        allow('cognito-idp:AdminGetUser', sub(
            'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + pool)),
    ]
    add('Role', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [{
            'Effect': 'Allow', 'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole',
        }]},
        'Policies': [{'PolicyName': 'ProductionMerchantReview', 'PolicyDocument': {
            'Version': '2012-10-17', 'Statement': statements,
        }}],
    })
    def transaction_attributes(fields, keys=None):
        conditions = {**transaction, **attributes(fields)}
        if keys:
            conditions.update(scope(keys))
            conditions['Null'] = {'dynamodb:LeadingKeys': 'false', 'dynamodb:Attributes': 'false'}
        return conditions

    approval_statements = [
        allow('dynamodb:Query', table('MerchantPlatform'),
              scope(['PERSON#*'])),
        allow([get, check], table('MerchantPlatform'),
              scope(['MERCHANT_PAYOUT#OWNERSHIP_REVISION#*', 'MERCHANT_CORRECTIONS#*'])),
        allow(put, table('MerchantPlatform'), transaction_attributes(
            'pk sk kind status leaseId requestId organizationId scopeDigest version expiresAt reviewerId checkedAt '
            'fenceVersion branchChecks settlementOwnerId settlementDestinationApproved settlementDecisionVersion '
            'destinationProofVersion branchIds activeAccessCount previousOwnerId newOwnerId completedAt',
            ['ORGANIZATION#*'])),
        allow('dynamodb:DeleteItem', table('MerchantPlatform'), transaction_attributes(
            'pk sk leaseId requestId scopeDigest version status expiresAt', ['ORGANIZATION#*'])),
        allow('dynamodb:DeleteItem', table('MerchantPlatform'), transaction_attributes(
            'pk sk subjectId organizationId version', ['PERSON#*'])),
        allow('dynamodb:UpdateItem', table('MerchantPlatform'), transaction_attributes(
            'pk sk status version digest reviewerId completedAt requestId', ['ORGANIZATION#*'])),
        allow('dynamodb:UpdateItem', table('MerchantPlatform'), transaction_attributes(
            'pk sk ownerId version updatedAt', ['MERCHANT_CORRECTIONS#*'])),
        allow(get, table('AccountDeletion'), scope(['BUSINESS_LIFECYCLE#MERCHANT#*'])),
        allow([put, 'dynamodb:DeleteItem'], table('AccountDeletion'), transaction_attributes(
            'pk sk kind leaseId requestId businessId expiresAt', ['BUSINESS_LIFECYCLE#MERCHANT#*'])),
        allow(check, table('Merchants')),
        allow('dynamodb:UpdateItem', table('Merchants'), transaction_attributes(
            'businessId ownerId cognitoUserId ownerName email organizationId brandId status version updatedAt '
            'orderIntakeTransferRequestId orderIntakeTransferExpiresAt orderIntakeDeletionRequestId deletionRequestId deletedAt isDeleted')),
        allow('dynamodb:UpdateItem', table('Wallets'), transaction_attributes(
            'walletId sk version status ownerId ownerType availableBalance lockedBalance', ['WALLET#MERCHANT#*'])),
        allow(put, table('WalletNotifications'), transaction_attributes(
            'eventId requestId organizationId action type recipientApp deliveryStatus attempts createdAt expiresAt nextAttemptAt ttl',
            ['OWNERSHIP_NOTICE#*#ownership_completed_*'])),
    ]
    add('OwnershipApprovalPolicy', 'AWS::IAM::ManagedPolicy', {
        'Roles': [ref('Role')], 'PolicyDocument': {'Version': '2012-10-17', 'Statement': approval_statements},
    })
    function = add('Function', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Handler': 'index.handler', 'Runtime': 'nodejs22.x', 'MemorySize': 512,
        'Timeout': 22, 'Role': attr('Role', 'Arn'), 'LoggingConfig': {'LogGroup': log},
        'Environment': {'Variables': {'ENVIRONMENT': 'production', 'PLATFORM_ENVIRONMENT': 'production'}},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
    }, DependsOn=['OwnershipApprovalPolicy'])
    api = add('Api', 'AWS::ApiGateway::RestApi', {'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']}})
    parents, methods = {'': attr('Api', 'RootResourceId')}, []
    for path, verb in ROUTES.items():
        current = ''
        for fragment in path.strip('/').split('/'):
            parent = parents[current]
            current += '/' + fragment
            if current not in parents:
                parents[current] = add('Route' + str(len(parents)), 'AWS::ApiGateway::Resource', {
                    'RestApiId': api, 'ParentId': parent, 'PathPart': fragment,
                })
        number = str(len(methods) + 1)
        method = 'Method' + number
        methods.append(method)
        add(method, 'AWS::ApiGateway::Method', {
            'RestApiId': api, 'ResourceId': parents[path], 'HttpMethod': verb, 'AuthorizationType': 'NONE',
            'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST', 'Uri': sub(
                'arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations'
            )},
        })
        add('Invoke' + number, 'AWS::Lambda::Permission', {
            'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com', 'FunctionName': function,
            'SourceAccount': ref('AWS::AccountId'),
            'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/' + verb + path),
        })
    add('Deployment', 'AWS::ApiGateway::Deployment', {'RestApiId': api}, DependsOn=methods[:5])
    add('ControlDeployment', 'AWS::ApiGateway::Deployment', {'RestApiId': api},
        DependsOn=[*methods[:6], 'Invoke6'])
    add('LifecycleDeployment', 'AWS::ApiGateway::Deployment', {'RestApiId': api},
        DependsOn=[*methods[:7], 'Invoke7'])
    deployment = add('LifecycleDecisionDeployment', 'AWS::ApiGateway::Deployment', {'RestApiId': api},
                     DependsOn=[*methods, 'Invoke' + str(len(methods))])
    add('Stage', 'AWS::ApiGateway::Stage', {
        'RestApiId': api, 'DeploymentId': deployment, 'StageName': 'production',
        'MethodSettings': [{'ResourcePath': '/*', 'HttpMethod': '*', 'DataTraceEnabled': False,
                            'ThrottlingRateLimit': 10, 'ThrottlingBurstLimit': 20}],
    })
    template['Outputs'] = {'ApiUrl': {'Condition': 'IsProductionAccount',
                                     'Value': sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/production')}}
    return template


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    data = package()
    (out / 'merchant-directory.zip').write_bytes(data)
    (out / 'merchant-directory.template.json').write_text(json.dumps(build(), separators=(',', ':')) + '\n')
    print(hashlib.sha256(data).hexdigest())
