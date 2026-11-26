"""Package authenticated customer, merchant and driver order updates for production."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import BUCKET, REPO, allow, attr, ref, sub, table
from prepare_merchant_response import STREAM

NAME = 'wizz-production-order-realtime'
ACCOUNT = '746727375268'


def package(output):
    bundle = subprocess.check_output([
        str(REPO / 'backend/wallet-service/node_modules/.bin/esbuild'),
        'backend/src/handlers/production-order-realtime.js', '--bundle', '--platform=node',
        '--target=node22', '--format=cjs', '--log-level=error', '--external:@aws-sdk/*',
    ], cwd=REPO)
    with ZipFile(output, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), bundle, compress_type=ZIP_DEFLATED)


def build():
    resources = {}

    def add(name, type_name, properties, **extra):
        resources[name] = {'Type': type_name, 'Condition': 'IsProduction', 'Properties': properties, **extra}

    add('Connections', 'AWS::DynamoDB::Table', {
        'TableName': 'wizz-production-OrderConnections', 'BillingMode': 'PAY_PER_REQUEST',
        'AttributeDefinitions': [{'AttributeName': key, 'AttributeType': 'S'} for key in ('connectionId','audience')],
        'KeySchema': [{'AttributeName': 'connectionId', 'KeyType': 'HASH'}],
        'GlobalSecondaryIndexes': [{'IndexName': 'Audience',
          'KeySchema': [{'AttributeName': 'audience', 'KeyType': 'HASH'}], 'Projection': {'ProjectionType': 'KEYS_ONLY'}}],
        'TimeToLiveSpecification': {'AttributeName': 'ttl', 'Enabled': True},
        'PointInTimeRecoverySpecification': {'PointInTimeRecoveryEnabled': True},
        'DeletionProtectionEnabled': True, 'SSESpecification': {'SSEEnabled': True},
    }, DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    add('Api','AWS::ApiGatewayV2::Api', {
        'Name': NAME, 'ProtocolType': 'WEBSOCKET', 'RouteSelectionExpression': '$request.body.action',
    })
    api_endpoint = sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/production')
    manage = allow('execute-api:ManageConnections',
                   sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/POST/@connections/*'))
    reads = [allow('dynamodb:GetItem', table(name)) for name in ('Orders','Customers','Merchants','Drivers','AccountDeletion')]
    deletion = allow('dynamodb:DeleteItem', attr('Connections','Arn'))
    bindings = json.loads((REPO/'infrastructure/production/wallet-identity-bindings.json').read_text())['identities']
    verify_identity = allow('cognito-idp:AdminGetUser', [
        sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + bindings[key]['poolId'])
        for key in ('customer','merchant','driver')
    ])
    for logical, suffix, handler, permissions in [
        ('Gateway', 'gateway','gateway',[*reads, manage, deletion, verify_identity,
            allow(['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:ConditionCheckItem'], attr('Connections','Arn')),
            allow('dynamodb:ConditionCheckItem', [table('Drivers'),table('AccountDeletion')]),
            allow('dynamodb:UpdateItem', table('DriverLiveState'))]),
        ('Broadcast','broadcast','broadcast',[*reads, manage, deletion, allow('dynamodb:GetItem', attr('Connections','Arn')),
            allow('dynamodb:Query', table('OrderConnections/index/Audience')),
            allow(['dynamodb:DescribeStream','dynamodb:GetRecords','dynamodb:GetShardIterator','dynamodb:ListStreams'], sub(STREAM)),
            {'Fn::If':['HasDispatchWorker',allow('lambda:InvokeFunction',ref('DispatchWorkerArn')),ref('AWS::NoValue')]},
            {'Fn::If':['HasPerformanceCollector',allow('lambda:InvokeFunction',ref('PerformanceCollectorArn')),ref('AWS::NoValue')]},
            {'Fn::If':['HasKitchenProjection',allow('lambda:InvokeFunction',ref('KitchenProjectionArn')),ref('AWS::NoValue')]}]),
    ]:
        name = NAME + '-' + suffix
        log = '/aws/lambda/' + name
        add(logical+'Log','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':90},
            DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
        logs = allow(['logs:CreateLogStream','logs:PutLogEvents'],
                     sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*'))
        add(logical+'Role', 'AWS::IAM::Role', {
            'AssumeRolePolicyDocument': {'Version': '2012-10-17','Statement': [{
                'Effect': 'Allow','Action': 'sts:AssumeRole','Principal': {'Service': 'lambda.amazonaws.com'}}]},
            'Policies': [{'PolicyName':'OrderRealtime','PolicyDocument':{'Version':'2012-10-17','Statement':[logs,*permissions]}}],
        })
        env = {'ENVIRONMENT':'production','REALTIME_MANAGEMENT_URL':api_endpoint}
        if logical == 'Broadcast':
            env['ORDER_STREAM_ARN'] = ref('OrdersStreamArn')
            env['PRODUCTION_DISPATCH_WORKER_ARN'] = {'Fn::If':['HasDispatchWorker',ref('DispatchWorkerArn'),ref('AWS::NoValue')]}
            env['PRODUCTION_KITCHEN_PROJECTION_ARN'] = {'Fn::If':['HasKitchenProjection',ref('KitchenProjectionArn'),ref('AWS::NoValue')]}
            env['PRODUCTION_PERFORMANCE_COLLECTOR_ARN'] = {'Fn::If':['HasPerformanceCollector',ref('PerformanceCollectorArn'),ref('AWS::NoValue')]}
        add(logical, 'AWS::Lambda::Function', {
            'FunctionName': name, 'Runtime':'nodejs22.x','Handler':'index.'+handler,'Role':attr(logical+'Role','Arn'),
            'Code': {'S3Bucket':BUCKET,'S3Key':ref('ArtifactKey'),'S3ObjectVersion':ref('ArtifactVersion')},
            'Environment':{'Variables':env},'MemorySize':512,'Timeout':20 if logical=='Gateway' else 50,
            'LoggingConfig':{'LogGroup':ref(logical+'Log')},
        })
    add('Integration','AWS::ApiGatewayV2::Integration',{
        'ApiId':ref('Api'),'IntegrationType':'AWS_PROXY','IntegrationMethod':'POST',
        'IntegrationUri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Gateway.Arn}/invocations'),
    })
    routes = []
    for logical, key in [('Connect','$connect'),('Disconnect','$disconnect'),('Default','$default')]:
        add(logical,'AWS::ApiGatewayV2::Route',{
            'ApiId':ref('Api'),'RouteKey':key,'AuthorizationType':'NONE','Target':sub('integrations/${Integration}'),
        })
        add(logical+'Invoke','AWS::Lambda::Permission',{
            'FunctionName':ref('Gateway'),'Action':'lambda:InvokeFunction','Principal':'apigateway.amazonaws.com',
            'SourceAccount':ref('AWS::AccountId'),
            'SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+key),
        })
        routes.extend([logical,logical+'Invoke'])
    add('Production','AWS::ApiGatewayV2::Stage', {
        'ApiId':ref('Api'),'StageName':'production','AutoDeploy':True,
        'DefaultRouteSettings':{'ThrottlingBurstLimit':120,'ThrottlingRateLimit':60,'DataTraceEnabled':False},
    }, DependsOn=routes)
    add('OrdersStream','AWS::Lambda::EventSourceMapping',{
        'FunctionName':ref('Broadcast'),'EventSourceArn':ref('OrdersStreamArn'),'StartingPosition':'LATEST',
        'Enabled':True,'BatchSize':10,'BisectBatchOnFunctionError':True,'MaximumRetryAttempts':4,
        'FilterCriteria':{'Filters':[{'Pattern':json.dumps({'eventName':['INSERT','MODIFY'],
            'dynamodb':{'NewImage':{'SK':{'S':['META']},'PK':{'S':[{'prefix':'ORDER#'}]}}}},separators=(',',':'))}]},
    }, DependsOn='Production')
    return {
        'AWSTemplateFormatVersion':'2010-09-09',
        'Description':'Production order WebSocket gateway and scoped stream notifications.',
        'Conditions':{'IsProduction':{'Fn::And':[
            {'Fn::Equals':[ref('AWS::AccountId'),ACCOUNT]},
            {'Fn::Equals':[ref('AWS::Region'),'us-east-1']},
        ]}, 'HasDispatchWorker':{'Fn::Not':[{'Fn::Equals':[ref('DispatchWorkerArn'),'']}] },
          'HasKitchenProjection':{'Fn::Not':[{'Fn::Equals':[ref('KitchenProjectionArn'),'']}] },
          'HasPerformanceCollector':{'Fn::Not':[{'Fn::Equals':[ref('PerformanceCollectorArn'),'']}] } },
        'Parameters':{
            'KitchenProjectionArn': {'Type':'String','Default':'','AllowedPattern':
              r'^$|^arn:aws:lambda:us-east-1:746727375268:function:wizz-production-hosted-kitchen-projection$'},
            'DispatchWorkerArn': {'Type':'String','Default':'','AllowedPattern':
              r'^$|^arn:aws:lambda:us-east-1:746727375268:function:wizz-production-dispatch-cycle$'},
            'PerformanceCollectorArn': {'Type':'String','Default':'','AllowedPattern':
              r'^$|^arn:aws:lambda:us-east-1:746727375268:function:wizz-production-driver-performance-collector$'},
            'ArtifactKey':{'Type':'String','AllowedPattern':'order-realtime/[a-f0-9]{64}[.]zip'},
            'ArtifactVersion':{'Type':'String','MinLength':1},
            'OrdersStreamArn':{'Type':'String','AllowedPattern':
               'arn:aws:dynamodb:us-east-1:746727375268:table/wizz-production-Orders/stream/[A-Za-z0-9_.:-]+'},
        },
        'Resources':resources,
        'Outputs':{'WebSocketUrl':{'Condition':'IsProduction','Value':sub('wss://${Api}.execute-api.${AWS::Region}.amazonaws.com/production')},
                   'ManagementUrl':{'Condition':'IsProduction','Value':api_endpoint}},
    }


if __name__ == '__main__':
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    archive = output/'order-realtime.zip'
    package(archive)
    (output/'order-realtime.template.json').write_text(json.dumps(build(),indent=2)+'\n')
    print(hashlib.sha256(archive.read_bytes()).hexdigest())
