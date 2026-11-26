"""Build the production owner verification gateway and its scoped permissions."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import ROOT, REPO, BUCKET, allow, attr, ref, sub, table
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-merchant-financial-session'
SESSION = 'MerchantFinancialSessions'


def build():
    baseline = json.loads((ROOT / 'storage-auth.template.json').read_text())
    template = {key: baseline[key] for key in ('AWSTemplateFormatVersion', 'Rules', 'Conditions')}
    template['Description'] = 'Merchant financial verification for verified production branch owners.'
    template['Parameters'] = {
        'ExpectedAccountId': baseline['Parameters']['ExpectedAccountId'],
        'ArtifactKey': {'Type': 'String', 'AllowedPattern': 'merchant-financial-session/[a-f0-9]{64}[.]zip'},
        'ArtifactVersion': {'Type': 'String', 'MinLength': 1},
        'MerchantOtpSecret': {
            'Type': 'String',
            'AllowedPattern': r'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/merchant/otp-[a-zA-Z0-9]{6}',
        },
    }
    resources = template['Resources'] = {}

    def add(logical, kind, props, **attributes):
        resources[logical] = {
            'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': props, **attributes,
        }

    merchant = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())['identities']['merchant']
    session_prefixes = ('MERCHANT_FINANCIAL_SESSION#*', 'MERCHANT_FINANCIAL_RATE#*')
    deletion_prefixes = ('BUSINESS_LIFECYCLE#MERCHANT#*', 'ACCOUNT_LIFECYCLE#MERCHANT#*')
    log = '/aws/lambda/' + NAME
    add('LogGroup', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    add('Role', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [{
            'Effect': 'Allow', 'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole',
        }]},
        'Policies': [{'PolicyName': 'MerchantVerification', 'PolicyDocument': {
            'Version': '2012-10-17', 'Statement': [
                allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
                      sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
                allow(['dynamodb:GetItem', 'dynamodb:ConditionCheckItem'], table('Merchants')),
                dynamodb('AccountDeletion', 'GetItem', deletion_prefixes),
                dynamodb('AccountDeletion', 'ConditionCheckItem', deletion_prefixes),
                dynamodb(SESSION, 'GetItem', session_prefixes),
                dynamodb(SESSION, 'PutItem', session_prefixes),
                allow('cognito-idp:AdminGetUser', sub(
                    'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + merchant['poolId'])),
                allow('secretsmanager:GetSecretValue', ref('MerchantOtpSecret')),
            ],
        }}],
    })
    add('Function', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Runtime': 'nodejs22.x', 'Handler': 'index.handler',
        'Role': attr('Role', 'Arn'),
        'Environment': {'Variables': {'ENVIRONMENT': 'production', 'OTP_SECRET_ARN': ref('MerchantOtpSecret'),
                                      'FINANCIAL_SESSION_TABLE': 'wizz-production-' + SESSION}},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
        'LoggingConfig': {'LogGroup': ref('LogGroup')}, 'MemorySize': 256, 'Timeout': 25,
    })
    add('Api', 'AWS::ApiGateway::RestApi', {'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']}})
    add('Auth', 'AWS::ApiGateway::Resource', {
        'RestApiId': ref('Api'), 'ParentId': attr('Api', 'RootResourceId'), 'PathPart': 'auth',
    })
    add('Session', 'AWS::ApiGateway::Resource', {
        'RestApiId': ref('Api'), 'ParentId': ref('Auth'), 'PathPart': 'merchant-financial-session',
    })
    dependencies = []
    for method in ('POST', 'OPTIONS'):
        add(method, 'AWS::ApiGateway::Method', {
            'RestApiId': ref('Api'), 'ResourceId': ref('Session'), 'HttpMethod': method,
            'AuthorizationType': 'NONE', 'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST',
                'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
                           '${Function.Arn}/invocations')},
        })
        add(method + 'Invoke', 'AWS::Lambda::Permission', {
            'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com',
            'FunctionName': ref('Function'), 'SourceAccount': ref('AWS::AccountId'),
            'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'
                             + method + '/auth/merchant-financial-session'),
        })
        dependencies.extend([method, method + 'Invoke'])
    add('Deployment', 'AWS::ApiGateway::Deployment', {'RestApiId': ref('Api')}, DependsOn=dependencies)
    add('Stage', 'AWS::ApiGateway::Stage', {
        'RestApiId': ref('Api'), 'DeploymentId': ref('Deployment'), 'StageName': 'production',
        'MethodSettings': [{'ResourcePath': '/*', 'HttpMethod': '*', 'ThrottlingBurstLimit': 12,
                            'ThrottlingRateLimit': 5, 'DataTraceEnabled': False}],
    })
    template['Outputs'] = {'ApiUrl': {'Condition': 'IsProductionAccount',
        'Value': sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/production')}}
    return template


def package(output):
    wallet = REPO / 'backend/wallet-service/node_modules'
    staff = REPO / 'backend/staff-service/node_modules'
    bundled = subprocess.check_output([
        str(wallet / '.bin/esbuild'), 'infrastructure/production/merchant-financial-session/index.cjs',
        '--bundle', '--platform=node', '--target=node22', '--format=cjs', '--keep-names', '--log-level=error',
        '--external:./settlement-runtime', '--external:./payout-otp-provider',
    ], cwd=REPO, env={**os.environ, 'NODE_PATH': os.pathsep.join((str(wallet), str(staff)))})
    with ZipFile(output, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), bundled, compress_type=ZIP_DEFLATED)


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    artifact = out / 'merchant-financial-session.zip'
    package(artifact)
    (out / 'merchant-financial-session.template.json').write_text(json.dumps(build(), indent=2) + '\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
