"""Package the audited production staff policy API from the shared staging workflow."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import BUCKET, ROOT, REPO, allow, attr, ref, sub
from prepare_merchant_financial_session import build as verification_template
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-merchant-staff-policy'
PATH = '/staff/merchants/staff-policy'
POLICY = ('OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',)


def build():
    reference = verification_template()
    template = {key: reference[key] for key in ('AWSTemplateFormatVersion', 'Rules', 'Conditions', 'Outputs')}
    template['Description'] = 'Production merchant staff delegation policy, version history and audited changes.'
    template['Parameters'] = {key: value for key, value in reference['Parameters'].items() if key != 'MerchantOtpSecret'}
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'merchant-staff-policy/[a-f0-9]{64}[.]zip'
    resources = template['Resources'] = {}

    def add(key, kind, properties, **extra):
        resources[key] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': properties, **extra}

    admin = json.loads((ROOT/'wallet-identity-bindings.json').read_text())['identities']['admin']
    log = '/aws/lambda/' + NAME
    add('LogGroup', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    add('Role', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': reference['Resources']['Role']['Properties']['AssumeRolePolicyDocument'],
        'Policies': [{'PolicyName': 'MerchantStaffPolicy', 'PolicyDocument': {'Version': '2012-10-17', 'Statement': [
            allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
                  sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
            allow('cognito-idp:AdminGetUser', sub(
                'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + admin['poolId'])),
            dynamodb('PlatformStaff', 'GetItem', POLICY + ('EMPLOYEE#*',)),
            dynamodb('PlatformStaff', 'Query', POLICY),
            dynamodb('PlatformStaff', 'ConditionCheckItem', ('EMPLOYEE#*',)),
            dynamodb('PlatformStaff', 'PutItem', POLICY + ('AUDIT',)),
        ]}}],
    })
    add('Function', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Runtime': 'nodejs22.x', 'Handler': 'index.handler', 'Role': attr('Role', 'Arn'),
        'MemorySize': 256, 'Timeout': 18, 'LoggingConfig': {'LogGroup': ref('LogGroup')},
        'Environment': {'Variables': {'ENVIRONMENT': 'production', 'PLATFORM_ENVIRONMENT': 'production'}},
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
    })
    add('Api', 'AWS::ApiGateway::RestApi', {'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']}})
    parents = (('Staff', 'staff', attr('Api', 'RootResourceId')), ('Merchants', 'merchants', ref('Staff')),
               ('Policy', 'staff-policy', ref('Merchants')), ('History', 'history', ref('Policy')),
               ('Save', 'save', ref('Policy')))
    for name, part, parent in parents:
        add(name, 'AWS::ApiGateway::Resource', {'RestApiId': ref('Api'), 'ParentId': parent, 'PathPart': part})
    dependencies = []
    for label, method, path in (('Policy', 'GET', PATH), ('History', 'GET', PATH+'/history'), ('Save', 'POST', PATH+'/save')):
        key = label + method
        add(key, 'AWS::ApiGateway::Method', {
            'RestApiId': ref('Api'), 'ResourceId': ref(label), 'HttpMethod': method, 'AuthorizationType': 'NONE',
            'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST',
                            'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
                                       '${Function.Arn}/invocations')},
        })
        add(key+'Invoke', 'AWS::Lambda::Permission', {
            'Action': 'lambda:InvokeFunction', 'FunctionName': ref('Function'), 'Principal': 'apigateway.amazonaws.com',
            'SourceAccount': ref('AWS::AccountId'),
            'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/' + method + path),
        })
        dependencies.extend([key, key+'Invoke'])
    add('Deployment', 'AWS::ApiGateway::Deployment', {'RestApiId': ref('Api')}, DependsOn=dependencies)
    resources['Stage'] = reference['Resources']['Stage']
    return template


if __name__ == '__main__':
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    target = out/'index.js'
    subprocess.run(['node', str(ROOT/'merchant-settlements/bundle.cjs'),
                    str(ROOT/'merchant-staff-policy/index.cjs'), str(target)], cwd=REPO, check=True)
    artifact = out/'merchant-staff-policy.zip'
    with ZipFile(artifact, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), target.read_bytes(), compress_type=ZIP_DEFLATED)
    (out/'merchant-staff-policy.template.json').write_text(json.dumps(build(), separators=(',', ':'))+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
