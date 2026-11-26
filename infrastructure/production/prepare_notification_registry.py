"""Build the production device registry stack and its deterministic Lambda artifact."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import zipfile

from prepare_merchant_profile import build as build_profile

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
NAME = 'wizz-production-notification-registry'
REGISTRY = 'wizz-production-PushDeviceTokens'
ACTIVITIES = 'wizz-production-OrderLiveActivities'
STAGE = 'production'


def package():
    entry = """
const {register, unregister, soundSettings} = require('./backend/src/handlers/push-tokens');
const {badRequest, corsHeaders, jsonResponse} = require('./backend/src/utils/http');
const routes = new Map([
  ['/push/tokens/register', register],
  ['/push/tokens/unregister', unregister],
  ['/push/sounds', soundSettings]
]);
exports.handler = async event => {
  const route = routes.get(event.resource);
  if (event.requestContext?.stage !== 'production' || !route)
    return jsonResponse(404, {success: false, code: 'NOT_FOUND'});
  if (event.httpMethod === 'OPTIONS') return {statusCode:200, headers:corsHeaders, body:''};
  if (route === soundSettings && event.httpMethod === 'GET') return route(event);
  if (route === soundSettings || event.httpMethod !== 'POST') return jsonResponse(405, {success:false, code:'METHOD_NOT_ALLOWED'});
  if (event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 16000)
    return badRequest('Invalid device registration');
  let input;
  try { input = JSON.parse(event.body); } catch { return badRequest('Invalid device registration'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return badRequest('Invalid device registration');
  return route(event);
};
"""
    bundled = subprocess.check_output([
        str(REPO / 'backend/wallet-service/node_modules/.bin/esbuild'),
        '--bundle', '--platform=node', '--target=node22', '--format=cjs', '--log-level=error'
    ], input=entry.encode(), cwd=REPO)
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        item = zipfile.ZipInfo('index.js', (2026, 1, 1, 0, 0, 0))
        item.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(item, bundled)
    return out.getvalue()


def key(name, key_type='HASH'):
    return {'AttributeName': name, 'KeyType': key_type}


def table(name, keys, attributes, indexes=()):
    properties = {
        'TableName': name,
        'BillingMode': 'PAY_PER_REQUEST',
        'AttributeDefinitions': [{'AttributeName': attr, 'AttributeType': 'S'} for attr in attributes],
        'KeySchema': keys,
        'TimeToLiveSpecification': {'AttributeName': 'ttl', 'Enabled': True},
        'SSESpecification': {'SSEEnabled': True},
        'DeletionProtectionEnabled': True,
        'PointInTimeRecoverySpecification': {'PointInTimeRecoveryEnabled': True},
        'Tags': [{'Key': 'Environment', 'Value': STAGE}, {'Key': 'Project', 'Value': 'Wizz'}],
    }
    if indexes:
        properties['GlobalSecondaryIndexes'] = [
            {'IndexName': name, 'KeySchema': [key(field), key('token', 'RANGE')],
             'Projection': {'ProjectionType': 'ALL'}} for name, field in indexes
        ]
    return {'Type': 'AWS::DynamoDB::Table', 'Condition': 'IsProductionAccount',
            'DeletionPolicy': 'Retain', 'UpdateReplacePolicy': 'Retain', 'Properties': properties}


def build():
    template = build_profile()
    template['Description'] = 'Authenticated production push device registry and isolated Live Activity storage.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = r'notification-registry/[a-f0-9]{64}\.zip'
    resources = template['Resources']
    for name in ('Authorizer', 'Auth', 'Profile', 'GETMethod', 'POSTMethod', 'GETInvoke', 'POSTInvoke'):
        del resources[name]
    resources['DeviceTokens'] = table(
        REGISTRY, [key('token')], ('token', 'subjectId', 'businessId'),
        [('SubjectIdIndex', 'subjectId'), ('BusinessIdIndex', 'businessId')])
    resources['LiveActivities'] = table(ACTIVITIES, [key('pk'), key('sk', 'RANGE')], ('pk', 'sk'))

    def sub(value):
        return {'Fn::Sub': value}

    def database(name):
        return sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/' + name)

    def add(name, kind, properties):
        resources[name] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': properties}

    log_group = '/aws/lambda/' + NAME
    resources['LogGroup']['Properties']['LogGroupName'] = log_group
    transaction = {'StringEquals': {'dynamodb:EnclosingOperation': 'TransactWriteItems'}}
    statements = [
        {'Effect': 'Allow', 'Action': 'dynamodb:GetItem', 'Resource': database('wizz-production-PlatformStaff'),
         'Condition': {'ForAllValues:StringEquals': {'dynamodb:LeadingKeys': ['OPERATIONAL_SETTINGS#ORDER_RECEPTION']},
                       'Null': {'dynamodb:LeadingKeys': 'false'}}},
        {'Effect': 'Allow', 'Action': ['logs:CreateLogStream', 'logs:PutLogEvents'],
         'Resource': sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log_group + ':*')},
        {'Effect': 'Allow', 'Action': ['dynamodb:GetItem', 'dynamodb:DeleteItem'],
         'Resource': {'Fn::GetAtt': ['DeviceTokens', 'Arn']}},
        {'Effect': 'Allow', 'Action': 'dynamodb:PutItem',
         'Resource': {'Fn::GetAtt': ['DeviceTokens', 'Arn']}, 'Condition': transaction},
        {'Effect': 'Allow', 'Action': 'dynamodb:ConditionCheckItem',
         'Resource': database('wizz-production-Merchants')},
        {'Effect': 'Allow', 'Action': 'dynamodb:ConditionCheckItem',
         'Resource': database('wizz-production-AccountDeletion'), 'Condition': {
             'Null': {'dynamodb:LeadingKeys': 'false'},
             'ForAllValues:StringLike': {'dynamodb:LeadingKeys': [
                 'ACCOUNT_LIFECYCLE#CUSTOMER#*', 'ACCOUNT_LIFECYCLE#DRIVER#*',
                 'ACCOUNT_LIFECYCLE#MERCHANT#*', 'BUSINESS_LIFECYCLE#MERCHANT#*'
             ]}
         }},
    ]
    resources['Role']['Properties']['Policies'] = [{
        'PolicyName': 'DeviceRegistration', 'PolicyDocument': {'Version': '2012-10-17', 'Statement': statements}
    }]
    function = resources['Function']['Properties']
    function.update(FunctionName=NAME, Runtime='nodejs22.x')
    identities = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())['identities']
    variables = {'ENVIRONMENT': STAGE, 'STAGE': STAGE, 'PUSH_TOKENS_TABLE': {'Ref': 'DeviceTokens'}}
    for role, prefix in [('customer', 'USERS'), ('merchant', 'MERCHANTS'), ('driver', 'DRIVERS')]:
        variables[prefix + '_USER_POOL_ID'] = identities[role]['poolId']
        variables[prefix + '_CLIENT_ID'] = identities[role]['clientId']
    function['Environment']['Variables'] = variables
    resources['Api']['Properties']['Name'] = NAME
    add('Push', 'AWS::ApiGateway::Resource', {'RestApiId': {'Ref': 'Api'},
        'ParentId': {'Fn::GetAtt': ['Api', 'RootResourceId']}, 'PathPart': 'push'})
    add('Tokens', 'AWS::ApiGateway::Resource', {'RestApiId': {'Ref': 'Api'},
        'ParentId': {'Ref': 'Push'}, 'PathPart': 'tokens'})
    methods = []
    for action in ('register', 'unregister'):
        resource = action.title()
        add(resource, 'AWS::ApiGateway::Resource', {'RestApiId': {'Ref': 'Api'},
            'ParentId': {'Ref': 'Tokens'}, 'PathPart': action})
        for method in ('POST', 'OPTIONS'):
            name = resource + method
            add(name, 'AWS::ApiGateway::Method', {'RestApiId': {'Ref': 'Api'},
                'ResourceId': {'Ref': resource}, 'HttpMethod': method, 'AuthorizationType': 'NONE',
                'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST',
                    'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')}})
            add(name + 'Invoke', 'AWS::Lambda::Permission', {
                'Action': 'lambda:InvokeFunction', 'FunctionName': {'Ref': 'Function'},
                'Principal': 'apigateway.amazonaws.com', 'SourceAccount': {'Ref': 'AWS::AccountId'},
                'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/' + method + '/push/tokens/' + action)
            })
            methods.append(name)
    resources['Deployment']['DependsOn'] = methods
    add('Sounds', 'AWS::ApiGateway::Resource', {'RestApiId': {'Ref': 'Api'},
        'ParentId': {'Ref': 'Push'}, 'PathPart': 'sounds'})
    for method in ('GET', 'OPTIONS'):
        name = 'Sounds' + method
        add(name, 'AWS::ApiGateway::Method', {'RestApiId': {'Ref': 'Api'},
            'ResourceId': {'Ref': 'Sounds'}, 'HttpMethod': method, 'AuthorizationType': 'NONE',
            'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST',
                'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')}})
        add(name + 'Invoke', 'AWS::Lambda::Permission', {
            'Action': 'lambda:InvokeFunction', 'FunctionName': {'Ref': 'Function'},
            'Principal': 'apigateway.amazonaws.com', 'SourceAccount': {'Ref': 'AWS::AccountId'},
            'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/' + method + '/push/sounds'),
        })
    add('SoundPolicyDeployment', 'AWS::ApiGateway::Deployment', {'RestApiId': {'Ref': 'Api'}})
    resources['SoundPolicyDeployment']['DependsOn'] = [*methods, 'SoundsGET', 'SoundsOPTIONS']
    resources['Stage']['Properties']['DeploymentId'] = {'Ref': 'SoundPolicyDeployment'}

    resources['Stage']['Properties']['MethodSettings'][0].update(ThrottlingBurstLimit=100, ThrottlingRateLimit=50)
    template['Outputs'].update(DeviceTokensTable={'Value': {'Ref': 'DeviceTokens'}},
                               LiveActivitiesTable={'Value': {'Ref': 'LiveActivities'}})
    for output in template['Outputs'].values():
        output['Condition'] = 'IsProductionAccount'
    return template


if __name__ == '__main__':
    raw = package()
    digest = hashlib.sha256(raw).hexdigest()
    target = Path('/private/tmp/wizz-production-notification-registry-' + digest + '.zip')
    target.write_bytes(raw)
    (ROOT / 'notification-registry.template.json').write_text(json.dumps(build(), indent=2) + '\n')
    print(json.dumps({'artifact': str(target), 'sha256': digest, 'key': 'notification-registry/' + digest + '.zip'}))
