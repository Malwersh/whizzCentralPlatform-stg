"""Package the production customer home feed and audited staff editor."""
import hashlib
import io
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

from prepare_customer_storefront import BUCKET, CUSTOMER, ROOT, REPO, allow, attr, ref, sub, table

NAME = 'wizz-production-customer-home'
STAFF_PATH = '/staff/home-layout'
PUBLIC_PATH = '/customer/home-layout'
SLIDE_BUCKET = 'wizz-production-home-slides-746727375268'


def package():
    sdk = ROOT / 'driver-review' / 'node_modules'
    tool = str(REPO / 'backend/wallet-service/node_modules/.bin/esbuild')
    build_flags = ['--bundle', '--platform=node', '--target=node22', '--format=cjs',
                   '--log-level=error', '--external:@aws-sdk/client-*', '--external:@aws-sdk/lib-dynamodb']
    environment = {**os.environ, 'NODE_PATH': os.pathsep.join(map(str, [
        sdk, REPO / 'backend/wallet-service/node_modules',
    ]))}
    bundle = subprocess.check_output([
        tool, str(ROOT / 'customer-home/index.cjs'), *build_flags, '--external:./offer-eligibility.cjs',
    ], cwd=REPO, env=environment)
    eligible = subprocess.check_output([
        tool, 'src/functions/shared/offer-eligibility.js', *build_flags,
    ], cwd=CUSTOMER, env=environment)
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for filename, code in [('index.js', bundle), ('offer-eligibility.cjs', eligible)]:
            entry = zipfile.ZipInfo(filename, (2026, 1, 1, 0, 0, 0))
            archive.writestr(entry, code, compress_type=zipfile.ZIP_DEFLATED)
    return output.getvalue()


def leading(keys, operator='StringEquals'):
    return {
        'ForAllValues:' + operator: {'dynamodb:LeadingKeys': keys},
        'Null': {'dynamodb:LeadingKeys': 'false'},
    }


def build():
    base = json.loads((ROOT / 'storage-auth.template.json').read_text())
    template = {key: value for key, value in base.items() if key not in ('Resources', 'Outputs')}
    template['Description'] = 'Customer home layout with regional public projection and audited staff publication.'
    template['Parameters'].update({
        'ArtifactKey': {'Type': 'String', 'AllowedPattern': 'customer-home/[a-f0-9]{64}[.]zip'},
        'ArtifactVersion': {'Type': 'String', 'MinLength': 1},
    })
    resources = template['Resources'] = {}

    def add(logical_id, kind, properties, **attributes):
        resources[logical_id] = {
            'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': properties, **attributes,
        }
        return ref(logical_id)

    image_arn = sub('arn:${AWS::Partition}:s3:::' + SLIDE_BUCKET + '/home-slideshow/*')
    media_bucket = add('HomeSlideBucket', 'AWS::S3::Bucket', {
        'BucketName': SLIDE_BUCKET,
        'BucketEncryption': {'ServerSideEncryptionConfiguration': [
            {'ServerSideEncryptionByDefault': {'SSEAlgorithm': 'AES256'}},
        ]},
        'OwnershipControls': {'Rules': [{'ObjectOwnership': 'BucketOwnerEnforced'}]},
        'PublicAccessBlockConfiguration': {
            'BlockPublicAcls': True, 'IgnorePublicAcls': True, 'BlockPublicPolicy': True, 'RestrictPublicBuckets': True,
        },
    }, DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    add('HomeSlideBucketPolicy', 'AWS::S3::BucketPolicy', {
        'Bucket': media_bucket, 'PolicyDocument': {'Version': '2012-10-17', 'Statement': [{
            'Effect': 'Deny', 'Principal': '*', 'Action': 's3:*',
            'Resource': [sub('arn:${AWS::Partition}:s3:::' + SLIDE_BUCKET), image_arn],
            'Condition': {'Bool': {'aws:SecureTransport': 'false'}},
        }]},
    })

    get = 'dynamodb:GetItem'
    check = 'dynamodb:ConditionCheckItem'
    put = 'dynamodb:PutItem'
    staff_table = table('PlatformStaff')
    admin_pool = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())['identities']['admin']['poolId']
    staff_policy = [
        allow([get, check], staff_table, leading(['EMPLOYEE#*'], 'StringLike')),
        allow([get, check], staff_table, leading(['OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING', 'HOME_DISCOVERY'])),
        allow([get, put], staff_table, leading(['HOME_LAYOUT', 'HOME_SLIDESHOW'])),
        allow(['s3:GetObject', 's3:PutObject'], image_arn),
        allow([get, put], staff_table, leading(['HOME_DISCOVERY'])),
        allow([get, check], staff_table, leading(['CUSTOMER_INTERFACES', 'HOME_LAYOUT'])),
        allow(put, staff_table, leading(['CUSTOMER_INTERFACES'])),
        allow([get, check, put, 'dynamodb:Query'], staff_table, leading(['OPERATIONAL_SETTINGS#ORDER_RECEPTION', 'OPERATIONAL_SETTINGS#DRIVER_MAP_TOOLS', 'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS'])),
        allow(get, table('MenuCategories')),
        allow(get, table('DriverPerformanceSnapshots'), leading(['CONTROL'])),
        allow('dynamodb:Query', table('Products/index/BusinessIdIndex')),
        allow(put, staff_table, leading(['AUDIT'])),
        allow([get, 'dynamodb:Scan'], [table('Merchants'), table('Regions')]),
        allow([get, 'dynamodb:Scan'], [table('PlatformDiscounts'), table('MerchantDiscounts')]),
        allow([get, 'dynamodb:Query'], table('MerchantPlatform'), leading(['BRANCH#*'], 'StringLike')),
        allow('cognito-idp:AdminGetUser', sub(
            'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + admin_pool)),
    ]
    public_policy = [
        allow(get, staff_table, leading(['HOME_LAYOUT', 'HOME_DISCOVERY', 'HOME_SLIDESHOW', 'CUSTOMER_INTERFACES'])),
        allow('s3:GetObject', image_arn),
        allow([get, put], staff_table, leading(['HOME_MENU_PRICE'])),
        allow(get, [table(name) for name in
                    ('Customers', 'Regions', 'Merchants', 'MenuCategories', 'PlatformDiscounts', 'MerchantDiscounts')]),
        allow('dynamodb:Scan', [table('PlatformDiscounts'), table('MerchantDiscounts')]),
        allow('dynamodb:Scan', table('Merchants'), {
            'ForAllValues:StringEquals':{'dynamodb:Attributes':[
                'businessId','businessName','business_name','name','regionId','isActive','isDeleted','deletedAt',
                'platformSuspended','deletionRequestId','status']},
            'Null':{'dynamodb:Attributes':'false'},
        }),
        allow(get, table('AccountDeletion'), leading(['ACCOUNT_LIFECYCLE#CUSTOMER#*'], 'StringLike')),
        allow(get, table('OfferJourney'), leading(['USER#*'], 'StringLike')),
        allow(put, table('OfferJourney'), leading(['EVENT#*'], 'StringLike')),
        allow('dynamodb:UpdateItem', table('OfferJourney'), leading(['STATS#*'], 'StringLike')),
        allow('dynamodb:Scan', table('Orders'), {
            'ForAllValues:StringEquals':{'dynamodb:Attributes':[
                'PK','SK','userSub','userId','orderId','createdAt','discountId','promoCode','offerSnapshot','offerUsageRelease']},
            'StringEquals':{'dynamodb:Select':'SPECIFIC_ATTRIBUTES'},
            'Null':{'dynamodb:Attributes':'false'},
        }),
        allow([get, 'dynamodb:Query'], table('MerchantPlatform'), leading(['BRANCH#*'], 'StringLike')),
        allow('dynamodb:Query', table('Products/index/BusinessIdIndex')),
    ]
    api = add('Api', 'AWS::ApiGateway::RestApi', {
        'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']},
    })
    paths = {'': attr('Api', 'RootResourceId')}
    methods = []
    operations_paths = ['/staff/settings/driver-map', '/staff/settings/delivery-operations']
    sound_path = '/staff/settings/notification-sounds'
    for group, policy, routes in (
        ('Public', public_policy, [(PUBLIC_PATH, 'GET'), (PUBLIC_PATH, 'OPTIONS')]),
        ('Staff', staff_policy, [
            (STAFF_PATH, 'GET'), (STAFF_PATH + '/options', 'GET'),
            *((STAFF_PATH + '/' + action, 'POST') for action in ('draft', 'publish', 'rollback')),
            (STAFF_PATH + '/slides', 'GET'), (STAFF_PATH + '/slides', 'POST'),
            (STAFF_PATH + '/promotion-header/publish', 'POST'),
            (STAFF_PATH + '/classifications', 'GET'),
            (STAFF_PATH + '/classifications', 'POST'),
            (STAFF_PATH + '/interfaces', 'GET'),
            *((STAFF_PATH + '/interfaces/' + action, 'POST') for action in ('catalog', 'draft', 'publish', 'rollback')),
            (sound_path, 'GET'), (sound_path + '/changes', 'GET'),
            *((sound_path + '/' + action, 'POST') for action in ('upload', 'request', 'approve', 'reject')),
            *((path + suffix, method) for path in operations_paths for suffix, method in (
                ('', 'GET'), ('/changes', 'GET'), ('/request', 'POST'), ('/approve', 'POST'), ('/reject', 'POST'))),
        ]),
    ):
        function = group + 'Function'
        function_name = NAME + '-' + group.lower()
        log_name = '/aws/lambda/' + function_name
        log = add(group + 'Logs', 'AWS::Logs::LogGroup', {
            'LogGroupName': log_name, 'RetentionInDays': 90,
        }, DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
        role = group + 'Role'
        add(role, 'AWS::IAM::Role', {
            'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [{
                'Effect': 'Allow', 'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole',
            }]},
            'Policies': [{'PolicyName': group + 'HomeAccess', 'PolicyDocument': {
                'Version': '2012-10-17', 'Statement': [
                    allow(['logs:CreateLogStream', 'logs:PutLogEvents'], sub(
                        'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log_name + ':*')),
                    *policy,
                ],
            }}],
        })
        function_ref = add(function, 'AWS::Lambda::Function', {
            'FunctionName': function_name, 'Runtime': 'nodejs22.x', 'Handler': 'index.' + group.lower(),
            'Role': attr(role, 'Arn'), 'Environment': {'Variables': {
                'ENVIRONMENT': 'production', 'PLATFORM_ENVIRONMENT': 'production', 'HOME_SLIDE_BUCKET': media_bucket,
            }},
            'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
            'MemorySize': 384, 'Timeout': 15, 'LoggingConfig': {'LogGroup': log},
        })
        for path, verb in routes:
            current = ''
            for segment in path.strip('/').split('/'):
                parent = paths[current]
                current += '/' + segment
                if current not in paths:
                    paths[current] = add('Path' + str(len(paths)), 'AWS::ApiGateway::Resource', {
                        'RestApiId': api, 'ParentId': parent, 'PathPart': segment,
                    })
            number = str(len(methods) + 1)
            method = 'Method' + number
            methods.append(method)
            add(method, 'AWS::ApiGateway::Method', {
                'RestApiId': api, 'ResourceId': paths[path], 'HttpMethod': verb, 'AuthorizationType': 'NONE',
                'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST', 'Uri': sub(
                    'arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
                    + '${' + function + '.Arn}/invocations'),
                },
            })
            add('Invoke' + number, 'AWS::Lambda::Permission', {
                'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com',
                'FunctionName': function_ref, 'SourceAccount': ref('AWS::AccountId'),
                'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}'
                                 + '/production/' + verb + path),
            })

    ranking_name = NAME + '-rankings'
    ranking_log_name = '/aws/lambda/' + ranking_name + '/worker'
    ranking_log = add('RankingLogs', 'AWS::Logs::LogGroup', {
        'LogGroupName': ranking_log_name, 'RetentionInDays': 90,
    }, DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    add('RankingRole', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [{
            'Effect': 'Allow', 'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole',
        }]},
        'Policies': [{'PolicyName': 'HomeRanking', 'PolicyDocument': {
            'Version': '2012-10-17', 'Statement': [
                allow(['logs:CreateLogStream', 'logs:PutLogEvents'], sub(
                    'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + ranking_log_name + ':*')),
                allow([get, put], staff_table, leading(['HOME_DISCOVERY'])),
                allow('dynamodb:Scan', table('Orders'), {
                    'ForAllValues:StringEquals': {'dynamodb:Attributes': [
                        'PK', 'SK', 'orderId', 'businessId', 'branchId', 'restaurantId', 'storeId', 'merchantId',
                        'status', 'orderStatus', 'createdAt', 'isTestOrder', 'isTest', 'testMode', 'items']},
                    'Null': {'dynamodb:Attributes': 'false'},
                }),
            ],
        }}],
    })
    add('RankingFunction', 'AWS::Lambda::Function', {
        'FunctionName': ranking_name, 'Runtime': 'nodejs22.x', 'Handler': 'index.rankings',
        'Role': attr('RankingRole', 'Arn'), 'MemorySize': 384, 'Timeout': 120,
        'LoggingConfig': {'LogGroup': ranking_log},
        'Environment': {'Variables': {'ENVIRONMENT': 'production'}},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
    })
    add('RankingSchedule', 'AWS::Events::Rule', {
        'ScheduleExpression': 'rate(1 hour)', 'State': 'ENABLED',
        'Targets': [{'Arn': attr('RankingFunction', 'Arn'), 'Id': 'HomeRanking'}],
    })
    add('RankingInvocation', 'AWS::Lambda::Permission', {
        'Action': 'lambda:InvokeFunction', 'Principal': 'events.amazonaws.com',
        'FunctionName': ref('RankingFunction'), 'SourceArn': attr('RankingSchedule', 'Arn'),
    })

    notification_methods = methods[:-10]
    interface_methods = notification_methods[:-6]
    previous_methods = interface_methods[:-5]
    # Preserve the original deployment as a rollback point for the production stage.
    add('HomeDeployment', 'AWS::ApiGateway::Deployment', {'RestApiId': api}, DependsOn=methods[:7])
    add('HomeSlidesDeployment', 'AWS::ApiGateway::Deployment', {'RestApiId': api}, DependsOn=previous_methods[:-3])
    add('HomePromotionHeaderDeployment', 'AWS::ApiGateway::Deployment',
                     {'RestApiId': api}, DependsOn=previous_methods[:-2])
    add('HomeClassificationsDeployment', 'AWS::ApiGateway::Deployment',
                     {'RestApiId': api}, DependsOn=previous_methods)
    add('HomeSlideEventMethod', 'AWS::ApiGateway::Method', {
        'RestApiId': api, 'ResourceId': paths[PUBLIC_PATH], 'HttpMethod': 'POST', 'AuthorizationType': 'NONE',
        'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST', 'Uri': sub(
            'arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
            '${PublicFunction.Arn}/invocations')},
    })
    add('HomeSlideEventInvoke', 'AWS::Lambda::Permission', {
        'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com',
        'FunctionName': ref('PublicFunction'), 'SourceAccount': ref('AWS::AccountId'),
        'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/POST' + PUBLIC_PATH),
    })
    add('HomeLinkedSlidesDeployment', 'AWS::ApiGateway::Deployment',
                     {'RestApiId': api}, DependsOn=[*previous_methods, 'HomeSlideEventMethod'])
    add('HomeInterfacesDeployment', 'AWS::ApiGateway::Deployment',
                     {'RestApiId': api}, DependsOn=[*interface_methods, 'HomeSlideEventMethod'])
    add('HomeNotificationSettingsDeployment', 'AWS::ApiGateway::Deployment',
                     {'RestApiId': api}, DependsOn=[*notification_methods, 'HomeSlideEventMethod'])
    deployment = add('HomeDriverDeliverySettingsDeployment', 'AWS::ApiGateway::Deployment',
                     {'RestApiId': api}, DependsOn=[*methods, 'HomeSlideEventMethod'])
    add('Stage', 'AWS::ApiGateway::Stage', {
        'RestApiId': api, 'DeploymentId': deployment, 'StageName': 'production',
        'MethodSettings': [{'ResourcePath': '/*', 'HttpMethod': '*', 'DataTraceEnabled': False,
                            'ThrottlingRateLimit': 25, 'ThrottlingBurstLimit': 50}],
    })
    template['Outputs'] = {'ApiUrl': {
        'Condition': 'IsProductionAccount',
        'Value': sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/production'),
    }}
    return template


if __name__ == '__main__':
    target = Path(sys.argv[1])
    target.mkdir(parents=True, exist_ok=True)
    data = package()
    (target / 'customer-home.zip').write_bytes(data)
    (target / 'customer-home.template.json').write_text(json.dumps(build(), indent=2) + '\n')
    print(hashlib.sha256(data).hexdigest())
