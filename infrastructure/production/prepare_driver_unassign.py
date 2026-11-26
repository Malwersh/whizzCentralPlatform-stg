"""Package driver unassignment for the existing production driver profile gateway."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import BUCKET, REPO, allow, attr, ref, sub

PROFILE_STACK = 'wizz-production-driver-profile'
NAME = 'wizz-production-driver-unassign'
FINANCIAL_HOST = 'arn:aws:lambda:us-east-1:746727375268:function:wizz-production-order-financial'


def attach(template):
    resources = template['Resources']
    parameters = template['Parameters']
    assert 'DriverUnassignArtifactKey' not in parameters
    parameters['DriverUnassignArtifactKey'] = {'Type': 'String', 'AllowedPattern': r'driver-unassign/[a-f0-9]{64}[.]zip'}
    parameters['DriverUnassignArtifactVersion'] = {'Type': 'String', 'MinLength': 1}

    def add(key, kind, properties, **extra):
        assert key not in resources, key
        resources[key] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': properties, **extra}

    log = '/aws/lambda/' + NAME
    add('DriverUnassignLog', 'AWS::Logs::LogGroup',
        {'LogGroupName': log, 'RetentionInDays': 90}, DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    add('DriverUnassignRole', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [
            {'Effect': 'Allow', 'Action': 'sts:AssumeRole', 'Principal': {'Service': 'lambda.amazonaws.com'}},
        ]},
        'Policies': [{'PolicyName': 'InvokeProductionOrderFinance', 'PolicyDocument': {
            'Version': '2012-10-17', 'Statement': [
                allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
                      sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
                allow('lambda:InvokeFunction', FINANCIAL_HOST),
            ],
        }}],
    })
    add('DriverUnassignFunction', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Runtime': 'nodejs22.x', 'Handler': 'index.handler', 'MemorySize': 256, 'Timeout': 27,
        'Role': attr('DriverUnassignRole', 'Arn'), 'LoggingConfig': {'LogGroup': ref('DriverUnassignLog')},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('DriverUnassignArtifactKey'),
                 'S3ObjectVersion': ref('DriverUnassignArtifactVersion')},
        'Environment': {'Variables': {
            'ENVIRONMENT': 'production', 'FINANCIAL_ACCEPT_FUNCTION_ARN': FINANCIAL_HOST,
            'FINANCIAL_DISPATCH_MODE': 'REQUIRED', 'FINANCIAL_COD_ASSIGNMENTS_MODE': 'REQUIRED',
        }},
    })

    parent = ref('DriverResource')
    for logical, segment in [('DriverOrdersResource', 'orders'), ('DriverOrderResource', '{orderId}'),
                             ('DriverUnassignResource', 'financial-unassign')]:
        add(logical, 'AWS::ApiGateway::Resource', {
            'RestApiId': ref('Api'), 'ParentId': parent, 'PathPart': segment,
        })
        parent = ref(logical)
    add('DriverUnassignMethod', 'AWS::ApiGateway::Method', {
        'RestApiId': ref('Api'), 'ResourceId': parent, 'HttpMethod': 'POST', 'AuthorizationType': 'NONE',
        'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST', 'Uri': sub(
            'arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
            '${DriverUnassignFunction.Arn}/invocations')},
    })
    add('DriverUnassignInvoke', 'AWS::Lambda::Permission', {
        'FunctionName': ref('DriverUnassignFunction'), 'Action': 'lambda:InvokeFunction',
        'Principal': 'apigateway.amazonaws.com', 'SourceAccount': ref('AWS::AccountId'),
        'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:'
                         '${Api}/production/POST/driver/orders/*/financial-unassign'),
    })
    stage = resources['Stage']['Properties']
    current = stage['DeploymentId']['Ref']
    add('DriverUnassignDeployment', 'AWS::ApiGateway::Deployment', {'RestApiId': ref('Api')},
        DependsOn=resources[current]['DependsOn'] + ['DriverUnassignMethod', 'DriverUnassignInvoke'])
    stage['DeploymentId'] = ref('DriverUnassignDeployment')
    return template


def package(output):
    output.mkdir(parents=True, exist_ok=True)
    source = subprocess.check_output([
        str(REPO / 'backend/wallet-service/node_modules/.bin/esbuild'), 'infrastructure/production/driver-unassign.cjs',
        '--bundle', '--platform=node', '--target=node22', '--format=cjs', '--external:@aws-sdk/*', '--log-level=error',
    ], cwd=REPO)
    artifact = output / 'driver-unassign.zip'
    with ZipFile(artifact, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), source, compress_type=ZIP_DEFLATED)
    return hashlib.sha256(artifact.read_bytes()).hexdigest()


if __name__ == '__main__':
    current_template, output_dir = map(Path, sys.argv[1:])
    digest = package(output_dir)
    (output_dir / 'driver-profile-with-unassign.template.json').write_text(
        json.dumps(attach(json.loads(current_template.read_text())), separators=(',', ':')) + '\n')
    print(digest)
