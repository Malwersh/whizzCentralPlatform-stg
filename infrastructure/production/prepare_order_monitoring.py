"""Deploy the read-only staff order monitoring service against production indexes."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import BUCKET, REPO, allow, attr, ref, sub, table
from prepare_order_financial_runtime import build as financial_template, dynamodb
from prepare_order_returns import add_resource, resource, method

NAME = 'wizz-production-order-monitoring'


def build():
    base = financial_template()
    template = {key: base[key] for key in ('AWSTemplateFormatVersion', 'Rules')}
    template['Description'] = 'Production staff order history and dispatch monitor.'
    template['Conditions'] = {'IsProductionAccount': base['Conditions']['IsProductionAccount']}
    template['Parameters'] = {
        'ExpectedAccountId': base['Parameters']['ExpectedAccountId'],
        'ArtifactKey': {'Type': 'String', 'AllowedPattern': r'order-monitoring/[a-f0-9]{64}[.]zip'},
        'ArtifactVersion': {'Type': 'String', 'MinLength': 1},
    }
    template['Resources'] = {}
    env = {key: value for key, value in base['Resources']['Function']['Properties']['Environment']['Variables'].items()
           if isinstance(value, str)}
    env.update(STAGE='production', ENVIRONMENT='production', MONITORING_API_ID=ref('StaffApi'))
    log = '/aws/lambda/' + NAME
    add_resource(template, 'Log', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
                 DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    statements = [
        allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
        allow('cognito-idp:AdminGetUser', sub(
            'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + env['ADMIN_USER_POOL_ID'])),
        dynamodb('PlatformStaff', 'GetItem', ('EMPLOYEE#*',)),
        dynamodb('Orders', 'GetItem', ('ORDER#*',)),
        dynamodb('DispatchJobs', 'GetItem'),
        allow('dynamodb:Query', [table('Orders/index/' + name) for name in ('GSI_BusinessId', 'GSI_OrderNumber')]),
    ]
    role = {'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [
        {'Effect': 'Allow', 'Action': 'sts:AssumeRole', 'Principal': {'Service': 'lambda.amazonaws.com'}},
    ]}, 'Policies': [{'PolicyName': 'ReadOrderMonitoring', 'PolicyDocument': {'Version': '2012-10-17', 'Statement': statements}}]}
    add_resource(template, 'Role', 'AWS::IAM::Role', role)
    add_resource(template, 'MonitorFunction', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Handler': 'index.handler', 'Runtime': 'nodejs22.x', 'Timeout': 15, 'MemorySize': 384,
        'Role': attr('Role', 'Arn'), 'LoggingConfig': {'LogGroup': ref('Log')}, 'Environment': {'Variables': env},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
    })
    add_resource(template, 'StaffApi', 'AWS::ApiGateway::RestApi',
                 {'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']}})
    resource(template, 'StaffRoot', 'StaffApi', attr('StaffApi', 'RootResourceId'), 'staff')
    resource(template, 'MonitorRoot', 'StaffApi', ref('StaffRoot'), 'order-monitoring')
    resource(template, 'Detail', 'StaffApi', ref('MonitorRoot'), 'detail')
    dependencies = method(template, 'ListGet', 'StaffApi', 'MonitorRoot', 'GET', 'staff/order-monitoring',
                          function_name=NAME, dependency='MonitorFunction')
    dependencies += method(template, 'DetailGet', 'StaffApi', 'Detail', 'GET', 'staff/order-monitoring/detail',
                           function_name=NAME, dependency='MonitorFunction')
    add_resource(template, 'Deployment', 'AWS::ApiGateway::Deployment', {'RestApiId': ref('StaffApi')},
                 DependsOn=dependencies)
    add_resource(template, 'Stage', 'AWS::ApiGateway::Stage', {
        'StageName': 'production', 'RestApiId': ref('StaffApi'), 'DeploymentId': ref('Deployment'),
        'MethodSettings': [{'ResourcePath': '/*', 'HttpMethod': '*', 'ThrottlingBurstLimit': 16,
                            'ThrottlingRateLimit': 6, 'DataTraceEnabled': False}],
    })
    template['Outputs'] = {'StaffUrl': {'Condition': 'IsProductionAccount',
        'Value': sub('https://${StaffApi}.execute-api.${AWS::Region}.amazonaws.com/production')}}
    return template


if __name__ == '__main__':
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    source = subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'), 'infrastructure/production/order-monitoring/index.cjs',
        '--bundle', '--platform=node', '--target=node22', '--format=cjs', '--keep-names', '--external:@aws-sdk/*',
    ], cwd=REPO)
    artifact = out/'order-monitoring.zip'
    with ZipFile(artifact, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), source, compress_type=ZIP_DEFLATED)
    (out/'order-monitoring.template.json').write_text(json.dumps(build(), separators=(',', ':'))+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
