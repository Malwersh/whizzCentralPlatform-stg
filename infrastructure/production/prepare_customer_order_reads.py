"""Publish authenticated customer order reads on the existing production storefront API."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import BUCKET, CUSTOMER, REPO, ROOT, allow, attr, ref, sub, table
from prepare_customer_delivery_quotes import build as quotes, leading

NAME = 'wizz-production-customer-order-reads'


def package(output):
    entry = subprocess.check_output([
        str(REPO / 'backend/wallet-service/node_modules/.bin/esbuild'),
        'src/production/customer-order-reads.js', '--bundle', '--platform=node', '--target=node22',
        '--format=cjs', '--log-level=error', '--external:@aws-sdk/*',
    ], cwd=CUSTOMER)
    with ZipFile(output, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), entry, compress_type=ZIP_DEFLATED)


def build():
    template = quotes()
    template['Parameters'].update({
        'OrderReadsArtifactKey': {'Type': 'String', 'AllowedPattern': 'customer-order-reads/[a-f0-9]{64}[.]zip'},
        'OrderReadsArtifactVersion': {'Type': 'String', 'MinLength': 1},
    })
    resources = template['Resources']

    def add(name, kind, properties, **extra):
        resources[name] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': properties, **extra}

    log = '/aws/lambda/' + NAME
    add('OrderReadsLogs', 'AWS::Logs::LogGroup', {'LogGroupName': log, 'RetentionInDays': 90},
        DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    statements = [
        allow(['logs:CreateLogStream','logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
        allow('dynamodb:GetItem', table('Orders'), leading('ORDER#*')),
        allow('dynamodb:Query', table('Orders/index/GSI_User')),
        allow('dynamodb:GetItem', table('Customers')),
        allow('dynamodb:GetItem', table('Drivers'), {
            'ForAllValues:StringEquals': {'dynamodb:Attributes': ['driverId', 'name', 'vehicleType', 'licenseNumber']},
            'Null': {'dynamodb:Attributes': 'false'},
        }),
    ]
    add('OrderReadsRole', 'AWS::IAM::Role', {
        'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [{
            'Effect': 'Allow', 'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole',
        }]},
        'Policies': [{'PolicyName': 'CustomerOrderReads', 'PolicyDocument': {'Version': '2012-10-17', 'Statement': statements}}],
    })
    customer = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())['identities']['customer']
    add('OrderReadsFunction', 'AWS::Lambda::Function', {
        'FunctionName': NAME, 'Runtime': 'nodejs22.x', 'Handler': 'index.handler', 'Role': attr('OrderReadsRole','Arn'),
        'Code': {'S3Bucket': BUCKET, 'S3Key': ref('OrderReadsArtifactKey'), 'S3ObjectVersion': ref('OrderReadsArtifactVersion')},
        'Environment': {'Variables': {'ENVIRONMENT': 'production', 'USER_POOL_ID': customer['poolId'],
                                      'USER_POOL_CLIENT_ID': customer['clientId']}},
        'MemorySize': 256, 'Timeout': 12, 'LoggingConfig': {'LogGroup': ref('OrderReadsLogs')},
    })
    # Find the existing user-id resource by its actual path in the storefront template.
    users = next(k for k, v in resources.items() if v['Type']=='AWS::ApiGateway::Resource'
                 and v['Properties']['PathPart']=='users' and v['Properties']['ParentId']==attr('Api','RootResourceId'))
    user_id = next(k for k, v in resources.items() if v['Type']=='AWS::ApiGateway::Resource'
                   and v['Properties']['PathPart']=='{user_id}' and v['Properties']['ParentId']==ref(users))
    for name, token, parent in [('OrdersRoot','orders',attr('Api','RootResourceId')),
                                ('OrderDetail','{orderId}',ref('OrdersRoot')),
                                ('UserOrderList','orders',ref(user_id))]:
        add(name, 'AWS::ApiGateway::Resource', {'RestApiId': ref('Api'), 'ParentId': parent, 'PathPart': token})
    methods = []
    for name, path in [('OrderDetail','orders/*'), ('UserOrderList','users/*/orders')]:
        for verb in ('GET','OPTIONS'):
            method = name + verb
            permission = method + 'Invoke'
            add(method, 'AWS::ApiGateway::Method', {
                'RestApiId': ref('Api'), 'ResourceId': ref(name), 'HttpMethod': verb, 'AuthorizationType': 'NONE',
                'Integration': {'IntegrationHttpMethod': 'POST', 'Type': 'AWS_PROXY',
                                'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/'
                                           '${OrderReadsFunction.Arn}/invocations')},
            })
            add(permission, 'AWS::Lambda::Permission', {
                'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com', 'FunctionName': ref('OrderReadsFunction'),
                'SourceAccount': ref('AWS::AccountId'),
                'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+verb+'/'+path),
            })
            methods.extend([method, permission])
    stage = resources['Stage']['Properties']
    previous = stage['DeploymentId']['Ref']
    deployment = resources.pop(previous)
    deployment['DependsOn'] += methods
    current = previous + 'OrderReads'
    resources[current] = deployment
    stage['DeploymentId'] = ref(current)
    return template


if __name__ == '__main__':
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    archive = output / 'customer-order-reads.zip'
    package(archive)
    (output / 'customer-order-reads.template.json').write_text(json.dumps(build(), indent=2) + '\n')
    print(hashlib.sha256(archive.read_bytes()).hexdigest())
