"""Production review queue and transactional decisions for cancellation cases."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import ROOT, REPO, BUCKET, allow, attr, ref, sub, table
from prepare_order_financial_runtime import build as financial_template, dynamodb

NAME = 'wizz-production-order-cancellation-review'


def build():
    baseline = financial_template()
    template = {key: baseline[key] for key in ('AWSTemplateFormatVersion', 'Rules')}
    template['Description'] = 'Staff queue and decisions for production order cancellations.'
    template['Conditions'] = {'IsProductionAccount': baseline['Conditions']['IsProductionAccount']}
    template['Parameters'] = {
        key: baseline['Parameters'][key] for key in ('ExpectedAccountId', 'ArtifactVersion', 'RolloutConfig', 'RolloutSha256')
    }
    template['Parameters']['ArtifactKey'] = {
        'Type': 'String', 'AllowedPattern': r'order-cancellation-review/[a-f0-9]{64}[.]zip',
    }
    resources = template['Resources'] = {}

    def add(key, kind, props, **attributes):
        resources[key] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': props, **attributes}

    existing_role = baseline['Resources']['Role']['Properties']
    statements = existing_role['Policies'][1]['Fn::If'][1]['PolicyDocument']['Statement']
    reads = [statement for statement in statements if statement['Action'] in ('dynamodb:GetItem', 'dynamodb:ConditionCheckItem')]
    writes = [statement for statement in statements if statement['Action'] in ('dynamodb:PutItem', 'dynamodb:UpdateItem')]
    reads.extend([
        dynamodb('PlatformStaff', 'GetItem', ('EMPLOYEE#*',)),
        dynamodb('PlatformStaff', 'ConditionCheckItem', ('EMPLOYEE#*',)),
        allow('dynamodb:Query', sub(table('Orders')['Fn::Sub'] + '/index/GSI_OrderNumber')),
        {
            **allow('dynamodb:Query', sub(table('WalletLifecycle')['Fn::Sub'] + '/index/ByDue')),
            'Condition': {'ForAllValues:StringEquals': {'dynamodb:LeadingKeys': ['ORDER_EXCEPTIONS_OPEN']},
                          'Null': {'dynamodb:LeadingKeys': 'false'}},
        },
    ])
    identities = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())['identities']
    reads.append(allow('cognito-idp:AdminGetUser', sub(
        'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + identities['admin']['poolId'])))
    # Separate policies stay within IAM's per-policy document size.
    for key, section in [('ReadOrders', reads), ('WriteDecisions', writes)]:
        add(key, 'AWS::IAM::ManagedPolicy', {'PolicyDocument': {'Version': '2012-10-17', 'Statement': section}})
    merchant_wallets = ('WALLET#MERCHANT#*',)
    compensation = [
        dynamodb('MerchantPlatform', 'GetItem', ('MERCHANT_ACCRUAL#*', 'MERCHANT_PAYOUT_PAID#MPO:*')),
        dynamodb('MerchantPlatform', 'ConditionCheckItem', ('MERCHANT_PAYOUT_PAID#MPO:*',)),
        dynamodb('MerchantPlatform', 'PutItem', ('MERCHANT_ACCRUAL#*',)),
        *[dynamodb('Wallets', action, merchant_wallets) for action in ('GetItem', 'ConditionCheckItem', 'UpdateItem')],
        dynamodb('LedgerEntries', 'PutItem', merchant_wallets),
    ]
    add('CompensationAccess', 'AWS::IAM::ManagedPolicy', {
        'PolicyDocument': {'Version': '2012-10-17', 'Statement': compensation},
    })
    log = '/aws/lambda/' + NAME
    add('LogGroup', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    add('Role', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': existing_role['AssumeRolePolicyDocument'],
        'ManagedPolicyArns': [ref('ReadOrders'), ref('WriteDecisions'), ref('CompensationAccess')],
        'Policies': [{'PolicyName': 'ReviewLogs', 'PolicyDocument': {'Version': '2012-10-17', 'Statement': [
            allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
                  sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
        ]}}],
    })
    env = dict(baseline['Resources']['Function']['Properties']['Environment']['Variables'])
    env.update(FINANCIAL_ORDER_HOST_MODE='GENERAL', FINANCIAL_DISPATCH_MODE='REQUIRED',
               FINANCIAL_COD_ASSIGNMENTS_MODE='REQUIRED', FINANCE_GENERAL_RELEASE_MODE='REQUIRED')
    add('Function', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Runtime': 'nodejs22.x', 'Handler': 'index.handler',
        'Role': attr('Role', 'Arn'), 'Environment': {'Variables': env},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
        'LoggingConfig': {'LogGroup': ref('LogGroup')}, 'MemorySize': 384, 'Timeout': 28,
    })
    add('Api', 'AWS::ApiGateway::RestApi', {'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']}})
    add('Staff', 'AWS::ApiGateway::Resource', {
        'RestApiId': ref('Api'), 'ParentId': attr('Api', 'RootResourceId'), 'PathPart': 'staff',
    })
    add('Path', 'AWS::ApiGateway::Resource', {
        'RestApiId': ref('Api'), 'ParentId': ref('Staff'), 'PathPart': 'order-cancellation',
    })
    dependencies = []
    for method in ('GET', 'POST'):
        add(method, 'AWS::ApiGateway::Method', {
            'RestApiId': ref('Api'), 'ResourceId': ref('Path'), 'HttpMethod': method,
            'AuthorizationType': 'NONE', 'Integration': {'IntegrationHttpMethod': 'POST', 'Type': 'AWS_PROXY',
                'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
                           '${Function.Arn}/invocations')},
        })
        add(method + 'Invoke', 'AWS::Lambda::Permission', {
            'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com',
            'FunctionName': ref('Function'), 'SourceAccount': ref('AWS::AccountId'),
            'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'
                             + method + '/staff/order-cancellation'),
        })
        dependencies.extend([method, method + 'Invoke'])
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
    modules = REPO / 'backend/wallet-service/node_modules'
    bundled = subprocess.check_output([
        str(modules / '.bin/esbuild'), 'infrastructure/production/order-cancellation-review/index.cjs',
        '--bundle', '--platform=node', '--target=node22', '--format=cjs', '--keep-names', '--log-level=error',
    ], cwd=REPO, env={**os.environ, 'NODE_PATH': str(modules)})
    with ZipFile(output, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), bundled, compress_type=ZIP_DEFLATED)


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    artifact = out / 'order-cancellation-review.zip'
    package(artifact)
    (out / 'order-cancellation-review.template.json').write_text(json.dumps(build(), indent=2) + '\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
