"""Attach pickup reporting and staff follow-up to production."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import BUCKET, REPO, allow, attr, ref, sub, table
from prepare_order_financial_runtime import build as financial_template, dynamodb

NAME = 'wizz-production-pickup-issues'
STACK = 'wizz-production-driver-profile'


def attach(template):
    resources = template['Resources']
    parameters = template['Parameters']
    parameters['PickupIssuesArtifactKey'] = {'Type': 'String', 'AllowedPattern': r'pickup-issues/[a-f0-9]{64}[.]zip'}
    parameters['PickupIssuesArtifactVersion'] = {'Type': 'String', 'MinLength': 1}

    def add(key, kind, props, **attributes):
        assert key not in resources, key
        resources[key] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': props, **attributes}

    log = '/aws/lambda/' + NAME
    add('PickupIssuesLog', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    prefix = 'PICKUP_ISSUE#*'
    queue = 'PICKUP_ISSUE_OPEN'
    environment = financial_template()['Resources']['Function']['Properties']['Environment']['Variables']
    env = {key: value for key, value in environment.items() if isinstance(value, str)}
    env.update(PICKUP_DRIVER_API_ID=ref('Api'), PICKUP_STAFF_API_ID=ref('PickupIssuesStaffApi'))
    statements = [
        allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
        *[allow('cognito-idp:AdminGetUser', sub(
            'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + env[role + '_USER_POOL_ID']))
          for role in ('DRIVER', 'ADMIN')],
        *[dynamodb('Orders', action, ('ORDER#*',)) for action in ('GetItem', 'ConditionCheckItem', 'UpdateItem')],
        allow('dynamodb:Query', sub(table('Orders')['Fn::Sub'] + '/index/GSI_OrderNumber')),
        *[dynamodb('Holds', action, ()) for action in ('GetItem', 'ConditionCheckItem')],
        dynamodb('PlatformStaff', 'GetItem', ('EMPLOYEE#*', prefix)),
        dynamodb('PlatformStaff', 'ConditionCheckItem', ('EMPLOYEE#*',)),
        dynamodb('PlatformStaff', 'PutItem', (prefix, queue, 'AUDIT')),
        dynamodb('PlatformStaff', 'DeleteItem', (queue,)),
        dynamodb('PlatformStaff', 'Query', (queue,)),
        dynamodb('AccountDeletion', 'ConditionCheckItem', ('ACCOUNT_LIFECYCLE#DRIVER#*',)),
    ]
    add('PickupIssuesRole', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [
            {'Effect': 'Allow', 'Action': 'sts:AssumeRole', 'Principal': {'Service': 'lambda.amazonaws.com'}},
        ]},
        'Policies': [{'PolicyName': 'PickupIssues', 'PolicyDocument': {'Version': '2012-10-17', 'Statement': statements}}],
    })
    add('PickupIssuesFunction', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Runtime': 'nodejs22.x', 'Handler': 'index.handler', 'MemorySize': 384, 'Timeout': 14,
        'Role': attr('PickupIssuesRole', 'Arn'), 'LoggingConfig': {'LogGroup': ref('PickupIssuesLog')},
        'Environment': {'Variables': env},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('PickupIssuesArtifactKey'),
                 'S3ObjectVersion': ref('PickupIssuesArtifactVersion')},
    })

    def resource(key, api, parent, segment):
        add(key, 'AWS::ApiGateway::Resource', {'RestApiId': ref(api), 'ParentId': parent, 'PathPart': segment})

    def method(key, api, resource_key, verb, path):
        add(key, 'AWS::ApiGateway::Method', {
            'RestApiId': ref(api), 'ResourceId': ref(resource_key), 'HttpMethod': verb, 'AuthorizationType': 'NONE',
            'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST', 'Uri': sub(
                'arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
                '${PickupIssuesFunction.Arn}/invocations')},
        })
        invoke = key + 'Invoke'
        add(invoke, 'AWS::Lambda::Permission', {
            'FunctionName': ref('PickupIssuesFunction'), 'Action': 'lambda:InvokeFunction',
            'Principal': 'apigateway.amazonaws.com', 'SourceAccount': ref('AWS::AccountId'),
            'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:'
                             '${' + api + '}/production/' + verb + '/' + path),
        })
        return [key, invoke]

    resource('DriverPickupIssueResource', 'Api', ref('DriverOrderResource'), 'issue')
    driver_dependencies = method('DriverPickupIssuePost', 'Api', 'DriverPickupIssueResource', 'POST', 'driver/orders/*/issue')
    stage = resources['Stage']['Properties']
    current = stage['DeploymentId']['Ref']
    add('DriverPickupIssuesDeployment', 'AWS::ApiGateway::Deployment', {'RestApiId': ref('Api')},
        DependsOn=resources[current]['DependsOn'] + driver_dependencies)
    stage['DeploymentId'] = ref('DriverPickupIssuesDeployment')

    api = 'PickupIssuesStaffApi'
    add(api, 'AWS::ApiGateway::RestApi', {'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']}})
    resource('PickupIssuesStaffRoot', api, attr(api, 'RootResourceId'), 'staff')
    resource('PickupIssuesStaffResource', api, ref('PickupIssuesStaffRoot'), 'pickup-issues')
    dependencies = []
    for verb in ('GET', 'POST'):
        dependencies.extend(method('PickupIssuesStaff' + verb.title(), api, 'PickupIssuesStaffResource', verb, 'staff/pickup-issues'))
    add('PickupIssuesStaffDeployment', 'AWS::ApiGateway::Deployment', {'RestApiId': ref(api)}, DependsOn=dependencies)
    add('PickupIssuesStaffStage', 'AWS::ApiGateway::Stage', {
        'RestApiId': ref(api), 'DeploymentId': ref('PickupIssuesStaffDeployment'), 'StageName': 'production',
        'MethodSettings': [{'ResourcePath': '/*', 'HttpMethod': '*', 'ThrottlingBurstLimit': 18,
                            'ThrottlingRateLimit': 8, 'DataTraceEnabled': False}],
    })
    template['Outputs']['PickupIssuesStaffApiUrl'] = {
        'Condition': 'IsProductionAccount',
        'Value': sub('https://${PickupIssuesStaffApi}.execute-api.${AWS::Region}.amazonaws.com/production'),
    }
    return template


def package(output):
    modules = REPO / 'backend/wallet-service/node_modules'
    bundled = subprocess.check_output([
        str(modules / '.bin/esbuild'), 'infrastructure/production/pickup-issues.cjs',
        '--bundle', '--platform=node', '--target=node22', '--format=cjs', '--keep-names', '--log-level=error',
        '--external:@aws-sdk/*',
    ], cwd=REPO)
    with ZipFile(output, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), bundled, compress_type=ZIP_DEFLATED)


if __name__ == '__main__':
    current, out = map(Path, sys.argv[1:])
    out.mkdir(parents=True, exist_ok=True)
    artifact = out / 'pickup-issues.zip'
    package(artifact)
    (out / 'driver-profile-with-pickup-issues.template.json').write_text(
        json.dumps(attach(json.loads(current.read_text())), separators=(',', ':')) + '\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
