"""Package production agreements with distinct staff and owner execution roles."""
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

NAME = 'wizz-production-merchant-commercial'
STAFF_PATH = '/staff/merchants/agreements'
OWNER_PATH = '/auth/commercial-agreements'


def build():
    base = json.loads((ROOT / 'storage-auth.template.json').read_text())
    result = {k: v for k, v in base.items() if k not in ('Resources', 'Outputs')}
    result['Description'] = 'Production merchant commission and service fee agreements.'
    result['Parameters'].update(ArtifactKey={'Type': 'String', 'AllowedPattern': 'merchant-commercial/[a-f0-9]{64}[.]zip'},
                                ArtifactVersion={'Type': 'String', 'MinLength': 1})
    r = result['Resources'] = {}

    def add(name, kind, props, **extra):
        r[name] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': props, **extra}
        return ref(name)

    api = add('Api', 'AWS::ApiGateway::RestApi', {'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']}})
    scope = lambda keys: leading(keys, 'StringLike')
    transaction = {'StringEquals': {'dynamodb:EnclosingOperation': 'TransactWriteItems'}}
    get, check, put = 'dynamodb:GetItem', 'dynamodb:ConditionCheckItem', 'dynamodb:PutItem'
    commercial_keys = scope(['BRANCH#*', 'COMMERCIAL_AGREEMENT#*'])
    funding_keys = scope(['DISCOUNT_FUNDING#*'])
    discounts = [table('MerchantDiscounts'), table('PlatformDiscounts')]
    common = [
        allow([get, check], table('MerchantPlatform'), scope(['PERSON#*', 'BRANCH#*', 'COMMERCIAL_AGREEMENT#*'])),
        allow('dynamodb:Query', table('MerchantPlatform'), scope(['BRANCH#*'])),
        allow(put, table('MerchantPlatform'), {**commercial_keys, **transaction}),
        allow([get, check], table('Merchants')),
        allow(check, table('AccountDeletion'), scope(['ACCOUNT_LIFECYCLE#MERCHANT#*', 'BUSINESS_LIFECYCLE#MERCHANT#*'])),
        allow(put, table('PlatformStaff'), {**leading(['AUDIT']), **transaction}),
        allow([get, check], discounts),
        allow([get, check], table('PlatformStaff'), funding_keys),
        allow([get, check], table('PlatformStaff'), leading(['OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS'])),
    ]
    pool = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())['identities']['admin']['poolId']
    staff_rules = [
        allow([get, check], table('PlatformStaff'), scope(['EMPLOYEE#*'])),
        allow([get, put, check], table('PlatformStaff'), scope(['COMMERCIAL_AGREEMENT#*'])),
        allow('dynamodb:UpdateItem', table('Merchants'), transaction),
        allow('dynamodb:Query', table('Merchants/index/ownerId-index')),
        allow('dynamodb:Scan', table('Merchants'), {
            'ForAllValues:StringEquals': {'dynamodb:Attributes':
                ['businessId','businessName','name','status','deletedAt','isDeleted','deletionRequestId']},
            'StringEquals': {'dynamodb:Select': 'SPECIFIC_ATTRIBUTES'},
            'Null': {'dynamodb:Attributes': 'false'},
        }),
        allow('dynamodb:Query', table('MerchantPlatform'), leading(['COMMERCIAL_FUNDING_QUEUE'])),
        allow(put, table('MerchantPlatform'), {**leading(['COMMERCIAL_FUNDING_QUEUE']), **transaction}),
        allow('dynamodb:Query', table('MerchantDiscounts/index/BusinessIdIndex')),
        allow('dynamodb:Scan', table('PlatformDiscounts')),
        allow(put, table('PlatformStaff'), {**funding_keys, **transaction}),
        allow(put, table('WalletNotifications'), {**scope(['COMMERCIAL_SHARING_NOTICE#*']), **transaction}),
        allow(put, table('MerchantPlatform'), {
            **scope(['CAMPAIGN_SHARING_LOCK#MERCHANT#*', 'CAMPAIGN_SHARING_LOCK#PLATFORM#*']), **transaction,
        }),
        allow('cognito-idp:AdminGetUser', sub(
            'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + pool)),
    ]
    owner_rules = [
        allow(put, table('PlatformStaff'), {
            **funding_keys, **transaction,
            'ForAllValues:StringLike': {
                **funding_keys['ForAllValues:StringLike'],
                'dynamodb:Attributes': ['pk','sk','subjectId','hash','acceptedAt','businessIds','acceptedRole','ownerId'],
            },
            'Null': {**funding_keys['Null'], 'dynamodb:Attributes': 'false'},
        }),
    ]
    paths = {'': attr('Api', 'RootResourceId')}
    methods = []
    for group, path, rules, verbs in (
        ('Staff', STAFF_PATH, staff_rules, ('GET', 'POST')),
        ('Owner', OWNER_PATH, owner_rules, ('GET', 'POST', 'OPTIONS')),
    ):
        function = group + 'Function'
        name = NAME + '-' + group.lower()
        log = add(group + 'Logs', 'AWS::Logs::LogGroup', {'LogGroupName': '/aws/lambda/' + name, 'RetentionInDays': 90},
                  DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
        role = group + 'Role'
        add(role, 'AWS::IAM::Role', {
            'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [{
                'Effect': 'Allow', 'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole',
            }]},
            'Policies': [{'PolicyName': group + 'CommercialAccess', 'PolicyDocument': {'Version': '2012-10-17',
                          'Statement': [allow(['logs:CreateLogStream', 'logs:PutLogEvents'], sub(
                              'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/' + name + ':*')),
                              *common, *rules]}}],
        })
        function_ref = add(function, 'AWS::Lambda::Function', {
            'FunctionName': name, 'Runtime': 'nodejs22.x', 'Handler': 'index.' + group.lower(), 'MemorySize': 384,
            'Timeout': 22, 'Role': attr(role, 'Arn'), 'LoggingConfig': {'LogGroup': log},
            'Environment': {'Variables': {'ENVIRONMENT': 'production', 'PLATFORM_ENVIRONMENT': 'production'}},
            'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
        })
        current = ''
        for segment in path.strip('/').split('/'):
            parent = paths[current]
            current += '/' + segment
            if current not in paths:
                paths[current] = add('Path' + str(len(paths)), 'AWS::ApiGateway::Resource',
                                     {'RestApiId': api, 'ParentId': parent, 'PathPart': segment})
        for verb in verbs:
            suffix = group + verb
            method = suffix + 'Method'
            methods.append(method)
            add(method, 'AWS::ApiGateway::Method', {
                'RestApiId': api, 'ResourceId': paths[path], 'HttpMethod': verb, 'AuthorizationType': 'NONE',
                'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST', 'Uri': sub(
                    'arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${' + function + '.Arn}/invocations')},
            })
            add(suffix + 'Invoke', 'AWS::Lambda::Permission', {
                'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com',
                'FunctionName': function_ref, 'SourceAccount': ref('AWS::AccountId'), 'SourceArn': sub(
                    'arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/' + verb + path),
            })
    deployment = add('Deployment', 'AWS::ApiGateway::Deployment', {'RestApiId': api}, DependsOn=methods)
    add('Stage', 'AWS::ApiGateway::Stage', {'RestApiId': api, 'DeploymentId': deployment,
        'StageName': 'production', 'MethodSettings': [{'ResourcePath': '/*', 'HttpMethod': '*',
            'DataTraceEnabled': False, 'ThrottlingRateLimit': 10, 'ThrottlingBurstLimit': 20}]})
    result['Outputs'] = {'ApiUrl': {'Condition': 'IsProductionAccount',
                                    'Value': sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/production')}}
    return result


def package():
    node = REPO / 'backend/wallet-service/node_modules'
    bundle = subprocess.check_output([
        str(node / '.bin/esbuild'), str(ROOT / 'merchant-commercial/index.cjs'), '--bundle', '--platform=node',
        '--target=node22', '--format=cjs', '--log-level=error', '--external:@aws-sdk/client-*', '--external:@aws-sdk/lib-dynamodb',
    ], cwd=REPO, env={**os.environ, 'NODE_PATH': os.pathsep.join(map(str, [ROOT / 'driver-review/node_modules', node]))})
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(zipfile.ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), bundle, compress_type=zipfile.ZIP_DEFLATED)
    return data.getvalue()


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    data = package()
    (out / 'merchant-commercial.zip').write_bytes(data)
    (out / 'merchant-commercial.template.json').write_text(json.dumps(build(), separators=(',', ':')) + '\n')
    print(hashlib.sha256(data).hexdigest())
