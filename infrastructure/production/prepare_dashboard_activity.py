"""Package read-only operational counts for the production admin dashboard."""
import json
import os
import sys
from pathlib import Path

from prepare_customer_storefront import BUCKET, REPO, allow, attr, ref, sub, table
from prepare_order_financial_runtime import build as financial_template, dynamodb
from prepare_order_returns import add_resource, method, resource
from prepare_staff_unassignment import bundled, package

NAME = 'wizz-production-dashboard-activity'
COUNT_TABLES = ('Orders', 'Merchants', 'DriverLiveState', 'Customers', 'SupportChatSessions')


def build():
    base = financial_template()
    template = {key: base[key] for key in ('AWSTemplateFormatVersion', 'Rules')}
    template['Description'] = 'Read-only operational counts for authorized production staff.'
    template['Conditions'] = {'IsProductionAccount': base['Conditions']['IsProductionAccount']}
    template['Parameters'] = {
        'ExpectedAccountId': base['Parameters']['ExpectedAccountId'],
        'ArtifactKey': {'Type': 'String', 'AllowedPattern': r'dashboard-activity/[a-f0-9]{64}[.]zip'},
        'ArtifactVersion': {'Type': 'String', 'MinLength': 1},
    }
    template['Resources'] = {}
    log = '/aws/lambda/' + NAME
    add_resource(template, 'Log', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
                 DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    with Path(__file__).with_name('wallet-identity-bindings.json').open() as source:
        admin_pool = json.load(source)['identities']['admin']['poolId']
    statements = [
        allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
        allow('cognito-idp:AdminGetUser', sub(
            'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + admin_pool)),
        dynamodb('PlatformStaff', 'GetItem', ('EMPLOYEE#*',)),
        {
            **allow('dynamodb:Scan', [table(name) for name in COUNT_TABLES]),
            'Condition': {'StringEquals': {'dynamodb:Select': 'COUNT'}},
        },
        allow('dynamodb:Scan', [table(name) for name in ('PlatformDiscounts', 'MerchantDiscounts')]),
        {
            **allow('dynamodb:Scan', table('MerchantPlatform')),
            'Condition': {
                'ForAllValues:StringEquals': {'dynamodb:Attributes': [
                    'pk', 'sk', 'kind', 'status', 'schemaVersion', 'settlementModel', 'createdAt', 'lines',
                ]},
                'StringEquals': {'dynamodb:Select': 'SPECIFIC_ATTRIBUTES'},
                'Null': {'dynamodb:Attributes': 'false'},
            },
        },
    ]
    add_resource(template, 'Role', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [
            {'Effect': 'Allow', 'Action': 'sts:AssumeRole', 'Principal': {'Service': 'lambda.amazonaws.com'}},
        ]},
        'Policies': [{'PolicyName': 'ReadDashboardActivity',
                      'PolicyDocument': {'Version': '2012-10-17', 'Statement': statements}}],
    })
    add_resource(template, 'DashboardFunction', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Handler': 'index.handler', 'Runtime': 'nodejs22.x', 'Timeout': 15,
        'MemorySize': 384, 'Role': attr('Role', 'Arn'), 'LoggingConfig': {'LogGroup': ref('Log')},
        'Environment': {'Variables': {'DASHBOARD_API_ID': ref('StaffApi')}},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
    })
    add_resource(template, 'StaffApi', 'AWS::ApiGateway::RestApi',
                 {'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']}})
    resource(template, 'StaffRoot', 'StaffApi', attr('StaffApi', 'RootResourceId'), 'staff')
    resource(template, 'Dashboard', 'StaffApi', ref('StaffRoot'), 'dashboard')
    resource(template, 'Activity', 'StaffApi', ref('Dashboard'), 'activity')
    dependencies = method(template, 'ActivityGet', 'StaffApi', 'Activity', 'GET', 'staff/dashboard/activity',
                          function_name=NAME, dependency='DashboardFunction')
    add_resource(template, 'Deployment', 'AWS::ApiGateway::Deployment', {'RestApiId': ref('StaffApi')},
                 DependsOn=dependencies)
    add_resource(template, 'Stage', 'AWS::ApiGateway::Stage', {
        'StageName': 'production', 'RestApiId': ref('StaffApi'), 'DeploymentId': ref('Deployment'),
        'MethodSettings': [{'ResourcePath': '/*', 'HttpMethod': '*', 'ThrottlingBurstLimit': 10,
                            'ThrottlingRateLimit': 4, 'DataTraceEnabled': False}],
    })
    template['Outputs'] = {'StaffUrl': {'Condition': 'IsProductionAccount',
        'Value': sub('https://${StaffApi}.execute-api.${AWS::Region}.amazonaws.com/production')}}
    return template


if __name__ == '__main__':
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    dependency_paths = [str(REPO / 'backend' / 'node_modules')]
    if os.environ.get('NODE_PATH'):
        dependency_paths.append(os.environ['NODE_PATH'])
    os.environ['NODE_PATH'] = os.pathsep.join(dependency_paths)
    print(package({'index.js': bundled('infrastructure/production/dashboard-activity.cjs')},
                  out / 'dashboard-activity.zip'))
    (out / 'dashboard-activity.template.json').write_text(json.dumps(build(), separators=(',', ':')) + '\n')
