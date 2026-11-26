"""Publish production cancellation callers using the existing private financial writer."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import ROOT, REPO, BUCKET, allow, attr, ref, sub, table

NAME = 'wizz-production-order-cancellation'
FINANCE = 'arn:aws:lambda:us-east-1:746727375268:function:wizz-production-order-financial'


def build():
    foundation = json.loads((ROOT / 'storage-auth.template.json').read_text())
    template = {key: foundation[key] for key in ('AWSTemplateFormatVersion', 'Rules', 'Conditions')}
    template['Description'] = 'Customer and merchant cancellation routes through the existing production financial writer.'
    template['Parameters'] = {
        'ExpectedAccountId': foundation['Parameters']['ExpectedAccountId'],
        'ArtifactKey': {'Type': 'String', 'AllowedPattern': 'order-cancellation/[a-f0-9]{64}[.]zip'},
        'ArtifactVersion': {'Type': 'String', 'MinLength': 1},
    }
    resources = template['Resources'] = {}

    def add(name, kind, properties, **attributes):
        resources[name] = {
            'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': properties, **attributes,
        }

    identities = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())['identities']
    log = '/aws/lambda/' + NAME
    add('LogGroup', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    add('Role', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [{
            'Effect': 'Allow', 'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole',
        }]},
        'Policies': [{'PolicyName': 'CancellationCallersOnly', 'PolicyDocument': {
            'Version': '2012-10-17', 'Statement': [
                allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
                      sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
                allow('lambda:InvokeFunction', FINANCE),
                allow('dynamodb:GetItem', table('Merchants')),
                allow('cognito-idp:AdminGetUser', sub(
                    'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' +
                    identities['merchant']['poolId'])),
            ],
        }}],
    })
    env = {
        'ENVIRONMENT': 'production', 'FINANCIAL_COD_ASSIGNMENTS_MODE': 'REQUIRED',
        'FINANCIAL_WORKFLOW_FUNCTION_ARN': FINANCE, 'FINANCIAL_ACCEPT_FUNCTION_ARN': FINANCE,
    }
    for role, binding in identities.items():
        env[role.upper() + '_USER_POOL_ID'] = binding['poolId']
        env[role.upper() + '_CLIENT_ID'] = binding['clientId']
    add('Function', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Runtime': 'nodejs22.x', 'Handler': 'index.handler',
        'Role': attr('Role', 'Arn'), 'Environment': {'Variables': env},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
        'LoggingConfig': {'LogGroup': ref('LogGroup')}, 'MemorySize': 256, 'Timeout': 28,
    })
    add('Api', 'AWS::ApiGateway::RestApi', {'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']}})
    dependencies = []
    for name, prefix, leaf, methods in [('Customer', 'order', 'cancel', ('POST', 'OPTIONS')),
                                        ('Merchant', 'auth', 'order-cancellation', ('GET', 'POST', 'OPTIONS'))]:
        add(name + 'Root', 'AWS::ApiGateway::Resource', {
            'RestApiId': ref('Api'), 'ParentId': attr('Api', 'RootResourceId'), 'PathPart': prefix,
        })
        add(name + 'Path', 'AWS::ApiGateway::Resource', {
            'RestApiId': ref('Api'), 'ParentId': ref(name + 'Root'), 'PathPart': leaf,
        })
        for method in methods:
            logical = name + method
            add(logical, 'AWS::ApiGateway::Method', {
                'RestApiId': ref('Api'), 'ResourceId': ref(name + 'Path'), 'HttpMethod': method,
                'AuthorizationType': 'NONE', 'Integration': {'IntegrationHttpMethod': 'POST', 'Type': 'AWS_PROXY',
                    'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
                               '${Function.Arn}/invocations')},
            })
            add(logical + 'Invoke', 'AWS::Lambda::Permission', {
                'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com',
                'FunctionName': ref('Function'), 'SourceAccount': ref('AWS::AccountId'),
                'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/' +
                                 method + '/' + prefix + '/' + leaf),
            })
            dependencies.extend([logical, logical + 'Invoke'])
    add('Deployment', 'AWS::ApiGateway::Deployment', {'RestApiId': ref('Api')}, DependsOn=dependencies)
    add('Stage', 'AWS::ApiGateway::Stage', {
        'RestApiId': ref('Api'), 'DeploymentId': ref('Deployment'), 'StageName': 'production',
        'MethodSettings': [{'ResourcePath': '/*', 'HttpMethod': '*', 'ThrottlingBurstLimit': 18,
                            'ThrottlingRateLimit': 8, 'DataTraceEnabled': False}],
    })
    template['Outputs'] = {'ApiUrl': {'Condition': 'IsProductionAccount',
        'Value': sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/production')}}
    return template


def package(output):
    wallet = REPO / 'backend/wallet-service/node_modules'
    order = REPO / 'backend/order-service/node_modules'
    bundled = subprocess.check_output([
        str(wallet / '.bin/esbuild'), 'infrastructure/production/order-cancellation/index.cjs',
        '--bundle', '--platform=node', '--target=node22', '--format=cjs', '--log-level=error',
    ], cwd=REPO, env={**os.environ, 'NODE_PATH': os.pathsep.join((str(wallet), str(order)))})
    with ZipFile(output, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), bundled, compress_type=ZIP_DEFLATED)


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    artifact = out / 'order-cancellation.zip'
    package(artifact)
    (out / 'order-cancellation.template.json').write_text(json.dumps(build(), indent=2) + '\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
