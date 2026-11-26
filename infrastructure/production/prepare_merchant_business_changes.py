"""Package the production owner and staff workflows for registered branch changes."""
import json
import os
import sys
from pathlib import Path

from prepare_customer_storefront import BUCKET, REPO, allow, attr, ref, sub, table
from prepare_order_financial_runtime import build as financial_template, dynamodb
from prepare_order_returns import add_resource, method, resource
from prepare_staff_unassignment import bundled, package

NAME = 'wizz-production-merchant-business-changes'


def build():
    baseline = financial_template()
    template = {name: baseline[name] for name in ('AWSTemplateFormatVersion', 'Rules')}
    template['Description'] = 'Production branch name and location changes with owner submission and staff review.'
    template['Conditions'] = {'IsProductionAccount': baseline['Conditions']['IsProductionAccount']}
    template['Parameters'] = {
        'ExpectedAccountId': baseline['Parameters']['ExpectedAccountId'],
        'ArtifactKey': {'Type': 'String', 'AllowedPattern': r'merchant-business-changes/[a-f0-9]{64}[.]zip'},
        'ArtifactVersion': {'Type': 'String', 'MinLength': 1},
    }
    template['Resources'] = {}
    identities = json.loads(Path(__file__).with_name('wallet-identity-bindings.json').read_text())['identities']
    pool_root = 'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/'
    merchant_pool = sub(pool_root + identities['merchant']['poolId'])
    log = '/aws/lambda/' + NAME
    add_resource(template, 'Log', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
                 DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    change_partitions = ('PERSON#*', 'REVIEW#MERCHANT')
    region_tables = ('Regions', 'RegionsDerived')
    branch_update = dynamodb('Merchants', 'UpdateItem')
    branch_update['Condition']['ForAllValues:StringEquals'] = {'dynamodb:Attributes': [
        'businessId', 'businessName', 'name', 'address', 'regionPath', 'regionNames', 'regionId',
        'countryId', 'governorateId', 'districtId', 'latitude', 'longitude', 'updatedAt',
        'ownerId', 'cognitoUserId', 'status', 'deletedAt', 'isDeleted', 'deletionRequestId', 'orderIntakeDeletionRequestId', 'lifecycleStatus',
    ]}
    branch_update['Condition']['Null'] = {'dynamodb:Attributes': 'false'}
    actions = [
        allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
        allow('cognito-idp:AdminGetUser', [merchant_pool, sub(pool_root + identities['admin']['poolId'])]),
        dynamodb('Merchants', 'GetItem'), dynamodb('Merchants', 'ConditionCheckItem'), branch_update,
        *[dynamodb('MerchantPlatform', verb, change_partitions) for verb in ('GetItem', 'Query', 'PutItem')],
        dynamodb('PlatformStaff', 'GetItem', ('EMPLOYEE#*',)),
        dynamodb('PlatformStaff', 'ConditionCheckItem', ('EMPLOYEE#*',)),
        dynamodb('PlatformStaff', 'PutItem', ('AUDIT',)),
        *[dynamodb('AccountDeletion', verb, ('ACCOUNT_LIFECYCLE#MERCHANT#*', 'BUSINESS_LIFECYCLE#MERCHANT#*'))
          for verb in ('GetItem', 'ConditionCheckItem')],
        *[dynamodb(region, verb) for region in region_tables for verb in ('GetItem', 'ConditionCheckItem')],
        allow('dynamodb:Query', table('RegionIndex/index/h3-index')),
    ]
    add_resource(template, 'Role', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [
            {'Effect': 'Allow', 'Action': 'sts:AssumeRole', 'Principal': {'Service': 'lambda.amazonaws.com'}},
        ]},
        'Policies': [{'PolicyName': 'ReviewBranchChanges',
                      'PolicyDocument': {'Version': '2012-10-17', 'Statement': actions}}],
    })
    add_resource(template, 'ChangesFunction', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Handler': 'index.handler', 'Runtime': 'nodejs22.x',
        'Timeout': 20, 'MemorySize': 384, 'Role': attr('Role', 'Arn'), 'LoggingConfig': {'LogGroup': ref('Log')},
        'Environment': {'Variables': {'MERCHANT_CHANGES_API_ID': ref('ChangesApi')}},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
    })
    add_resource(template, 'ChangesApi', 'AWS::ApiGateway::RestApi', {
        'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']},
    })
    add_resource(template, 'MerchantAuthorizer', 'AWS::ApiGateway::Authorizer', {
        'Name': 'ProductionMerchantIdentity', 'RestApiId': ref('ChangesApi'), 'Type': 'COGNITO_USER_POOLS',
        'IdentitySource': 'method.request.header.Authorization', 'ProviderARNs': [merchant_pool],
    })
    root = attr('ChangesApi', 'RootResourceId')
    for key, parent, segment in (
        ('AuthRoot', root, 'auth'), ('OwnerChanges', ref('AuthRoot'), 'business-changes'),
        ('StaffRoot', root, 'staff'), ('MerchantsRoot', ref('StaffRoot'), 'merchants'),
        ('StaffChanges', ref('MerchantsRoot'), 'changes'),
    ):
        resource(template, key, 'ChangesApi', parent, segment)
    dependencies = []
    for path, key in (('auth/business-changes', 'OwnerChanges'), ('staff/merchants/changes', 'StaffChanges')):
        for verb in ('GET', 'POST'):
            logical = key + verb
            dependencies += method(template, logical, 'ChangesApi', key, verb, path,
                                   function_name=NAME, dependency='ChangesFunction')
            if key == 'OwnerChanges':
                template['Resources'][logical]['Properties'].update(
                    AuthorizationType='COGNITO_USER_POOLS', AuthorizerId=ref('MerchantAuthorizer'))
    add_resource(template, 'Deployment', 'AWS::ApiGateway::Deployment', {'RestApiId': ref('ChangesApi')},
                 DependsOn=dependencies)
    add_resource(template, 'Stage', 'AWS::ApiGateway::Stage', {
        'StageName': 'production', 'RestApiId': ref('ChangesApi'), 'DeploymentId': ref('Deployment'),
        'MethodSettings': [{'ResourcePath': '/*', 'HttpMethod': '*', 'ThrottlingBurstLimit': 20,
                            'ThrottlingRateLimit': 8, 'DataTraceEnabled': False}],
    })
    template['Outputs'] = {'ServiceUrl': {'Condition': 'IsProductionAccount',
        'Value': sub('https://${ChangesApi}.execute-api.${AWS::Region}.amazonaws.com/production')}}
    return template


if __name__ == '__main__':
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    dependencies = [str(REPO / 'backend' / 'node_modules')]
    if os.environ.get('NODE_PATH'):
        dependencies.append(os.environ['NODE_PATH'])
    os.environ['NODE_PATH'] = os.pathsep.join(dependencies)
    print(package({'index.js': bundled('infrastructure/production/merchant-business-changes-api.cjs')},
                  out / 'merchant-business-changes.zip'))
    (out / 'merchant-business-changes.template.json').write_text(json.dumps(build(), separators=(',', ':')) + '\n')
