"""Build the isolated production customer address book and storefront stack."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
CUSTOMER = REPO.parent / 'wizzuser-stg' / 'backend'
NAME = 'wizz-production-customer-storefront'
BUCKET = 'wizz-production-artifacts-746727375268-us-east-1'

ADDRESS_ROUTES = {
    '/users/{user_id}/addresses': ('GET', 'POST'),
    '/users/{user_id}/addresses/{address_id}': ('GET', 'PUT', 'DELETE'),
    '/users/{user_id}/addresses/{address_id}/set-default': ('PUT',),
}
SEARCH_ROUTES = {'/users/{user_id}/address-search': ('POST',)}
CATALOG_ROUTES = {
    '/api/regions/find-by-coordinates': ('GET',),
    '/api/businesses/by-region': ('GET',),
    '/api/businesses/nearby': ('GET',),
    '/business/{businessId}': ('GET',),
    '/business/{businessId}/categories': ('GET',),
    '/business/{businessId}/products': ('GET',),
    '/business/{businessId}/working-hours': ('GET',),
    '/api/check-menu-version': ('POST',),
    '/api/check-listing-version': ('POST',),
    '/api/batch-check-versions': ('POST',),
}


def package():
    bundled = subprocess.check_output([
        str(REPO / 'backend/wallet-service/node_modules/.bin/esbuild'),
        'src/production/customer-storefront.js', '--bundle', '--platform=node',
        '--target=node22', '--format=cjs', '--log-level=error',
        '--external:@aws-sdk/*',
    ], cwd=CUSTOMER)
    memory = io.BytesIO()
    with zipfile.ZipFile(memory, 'w') as archive:
        entry = zipfile.ZipInfo('index.js', (2026, 1, 1, 0, 0, 0))
        archive.writestr(entry, bundled, compress_type=zipfile.ZIP_DEFLATED)
    return memory.getvalue()


def package_branch_menu_overlay(baseline):
    """Preserve the deployed catalog entry and add production menu visibility checks."""
    with zipfile.ZipFile(io.BytesIO(baseline)) as current:
        assert current.namelist() == ['index.js']
        source = current.read('index.js')
    entry = b"""'use strict';
const baseline = require('./baseline.js');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { wrapCatalog } = require('./branch-menu-catalog.js');
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 2 }));
const headers = {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};
const reply = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });
module.exports = { ...baseline, catalog: wrapCatalog({ db, catalog: baseline.catalog, reply }) };
"""
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w') as archive:
        files = {'index.js': entry, 'baseline.js': source,
                 'branch-menu-catalog.js': (CUSTOMER / 'src/production/branch-menu-catalog.js').read_bytes()}
        for name, content in files.items():
            archive.writestr(zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)), content,
                             compress_type=zipfile.ZIP_DEFLATED)
    return result.getvalue()


def sub(value):
    return {'Fn::Sub': value}


def ref(value):
    return {'Ref': value}


def attr(logical_id, attribute):
    return {'Fn::GetAtt': [logical_id, attribute]}


def table(name):
    return sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-' + name)


def allow(actions, resources, condition=None):
    grant = {'Effect': 'Allow', 'Action': actions, 'Resource': resources}
    if condition:
        grant['Condition'] = condition
    return grant


def build():
    base = json.loads((ROOT / 'storage-auth.template.json').read_text())
    template = {key: value for key, value in base.items() if key not in ('Resources', 'Outputs')}
    template['Description'] = 'Production customer addresses, service coverage and restaurant storefront.'
    template['Parameters'].update({
        'ArtifactKey': {'Type': 'String', 'AllowedPattern': 'customer-storefront/[a-f0-9]{64}[.]zip'},
        'ArtifactVersion': {'Type': 'String', 'MinLength': 1},
    })
    resources = template['Resources'] = {}

    def add(logical_id, kind, properties, retain=False):
        resources[logical_id] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': properties}
        if retain:
            resources[logical_id].update({'DeletionPolicy': 'Retain', 'UpdateReplacePolicy': 'Retain'})
        return ref(logical_id)

    region_names = ('Regions', 'RegionsDerived')
    common = [
        allow(['dynamodb:GetItem', 'dynamodb:Scan'], [table(name) for name in region_names]),
        allow('dynamodb:Query', table('RegionIndex/index/h3-index')),
    ]
    address_policy = common + [
        allow(['geo-places:Suggest', 'geo-places:GetPlace'], '*', {
            'StringEquals': {'aws:RequestedRegion': 'us-east-1'},
        }),
        allow('dynamodb:GetItem', [table('Customers'), table('Addresses')]),
        allow('dynamodb:Scan', table('Addresses')),
        allow('dynamodb:Query', table('Addresses/index/userId-index')),
        allow(['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'], table('Addresses')),
        allow('dynamodb:UpdateItem', table('Customers'), {
            'StringEquals': {'dynamodb:EnclosingOperation': 'TransactWriteItems'},
        }),
        allow('dynamodb:ConditionCheckItem', [table('Customers'), *(table(name) for name in region_names)]),
    ]
    catalog_policy = common + [
        allow(['dynamodb:GetItem', 'dynamodb:Scan', 'dynamodb:BatchGetItem'], table('Merchants')),
        allow('dynamodb:Query', [table('WorkingHours'), table('Products/index/BusinessIdIndex')]),
        allow(['dynamodb:GetItem', 'dynamodb:BatchGetItem'], table('RegionListings')),
        allow('dynamodb:BatchGetItem', [table('Products'), table('GlobalProducts'), table('MenuCategories')]),
        allow('dynamodb:Scan', table('MenuCategories')),
        allow(['dynamodb:GetItem', 'dynamodb:Query'], table('MerchantPlatform'), {
            'ForAllValues:StringLike': {'dynamodb:LeadingKeys': ['BRANCH#*']},
            'Null': {'dynamodb:LeadingKeys': 'false'},
        }),
        allow('dynamodb:GetItem', table('PlatformStaff'), {
            'ForAllValues:StringEquals': {'dynamodb:LeadingKeys': ['HOME_DISCOVERY']},
            'Null': {'dynamodb:LeadingKeys': 'false'},
        }),
    ]
    tables = {
        'REGIONS_TABLE': 'Regions', 'REGIONS_DERIVED_TABLE': 'RegionsDerived',
        'REGION_INDEX_TABLE': 'RegionIndex', 'ADDRESSES_TABLE': 'Addresses',
        'USERS_TABLE': 'Customers', 'BUSINESSES_TABLE': 'Merchants',
        'WORKING_HOURS_TABLE': 'WorkingHours', 'CATEGORIES_TABLE': 'MenuCategories',
        'PRODUCTS_TABLE': 'Products', 'GLOBAL_PRODUCTS_TABLE': 'GlobalProducts',
        'REGION_LISTINGS_TABLE': 'RegionListings', 'MERCHANT_PLATFORM_TABLE': 'MerchantPlatform',
        'DISCOVERY_TABLE': 'PlatformStaff',
    }
    identity = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())['identities']['customer']
    runtime_env = {key: 'wizz-production-' + name for key, name in tables.items()}
    runtime_env.update(ENVIRONMENT='production', USER_POOL_ID=identity['poolId'], USER_POOL_CLIENT_ID=identity['clientId'])

    api = add('Api', 'AWS::ApiGateway::RestApi', {
        'Name': NAME, 'EndpointConfiguration': {'Types': ['REGIONAL']},
    })
    paths = {'': attr('Api', 'RootResourceId')}
    methods = []
    for group, policy in (
        ('Addresses', address_policy), ('Catalog', catalog_policy),
    ):
        function = group + 'Function'
        function_name = NAME + '-' + group.lower()
        log_name = '/aws/lambda/' + function_name
        log = add(group + 'Logs', 'AWS::Logs::LogGroup', {'LogGroupName': log_name, 'RetentionInDays': 90}, retain=True)
        role = group + 'Role'
        add(role, 'AWS::IAM::Role', {
            'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [{
                'Effect': 'Allow', 'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole',
            }]},
            'Policies': [{'PolicyName': group + 'Access', 'PolicyDocument': {'Version': '2012-10-17', 'Statement': [
                allow(['logs:CreateLogStream', 'logs:PutLogEvents'], sub(
                    'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log_name + ':*'
                )),
                *policy,
            ]}}],
        })
        function_ref = add(function, 'AWS::Lambda::Function', {
            'FunctionName': function_name, 'Runtime': 'nodejs22.x', 'Handler': 'index.' + group.lower(),
            'Role': attr(role, 'Arn'), 'Environment': {'Variables': runtime_env},
            'Code': {'S3Bucket': BUCKET, 'S3Key': ref('ArtifactKey'), 'S3ObjectVersion': ref('ArtifactVersion')},
            'MemorySize': 512, 'Timeout': 15, 'LoggingConfig': {'LogGroup': log},
        })
        add(group + 'Invoke', 'AWS::Lambda::Permission', {
            'Action': 'lambda:InvokeFunction', 'Principal': 'apigateway.amazonaws.com',
            'FunctionName': function_ref, 'SourceAccount': ref('AWS::AccountId'),
            'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/*/*'),
        })
    for group, routes in (
        ('Addresses', ADDRESS_ROUTES), ('Catalog', CATALOG_ROUTES), ('Addresses', SEARCH_ROUTES),
    ):
        function = group + 'Function'
        for path, verbs in routes.items():
            current = ''
            for segment in path.strip('/').split('/'):
                parent = paths[current]
                current += '/' + segment
                if current not in paths:
                    paths[current] = add('Path' + str(len(paths)), 'AWS::ApiGateway::Resource', {
                        'RestApiId': api, 'ParentId': parent, 'PathPart': segment,
                    })
            for verb in (*verbs, 'OPTIONS'):
                name = 'Method' + str(len(methods) + 1)
                methods.append(name)
                add(name, 'AWS::ApiGateway::Method', {
                    'RestApiId': api, 'ResourceId': paths[path], 'HttpMethod': verb,
                    'AuthorizationType': 'NONE',
                    'Integration': {'IntegrationHttpMethod': 'POST', 'Type': 'AWS_PROXY',
                                    'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${' + function + '.Arn}/invocations')},
                })
    route_hash = hashlib.sha256(json.dumps([ADDRESS_ROUTES, CATALOG_ROUTES, SEARCH_ROUTES]).encode()).hexdigest()[:12]
    deployment = 'Deployment' + route_hash
    add(deployment, 'AWS::ApiGateway::Deployment', {'RestApiId': api})
    resources[deployment]['DependsOn'] = methods + ['AddressesInvoke', 'CatalogInvoke']
    add('Stage', 'AWS::ApiGateway::Stage', {
        'RestApiId': api, 'DeploymentId': ref(deployment), 'StageName': 'production',
        'MethodSettings': [
            {'ResourcePath': '/*', 'HttpMethod': '*', 'ThrottlingBurstLimit': 60,
             'ThrottlingRateLimit': 30, 'DataTraceEnabled': False},
            {'ResourcePath': '/~1users~1{user_id}~1address-search', 'HttpMethod': 'POST',
             'ThrottlingBurstLimit': 10, 'ThrottlingRateLimit': 5, 'DataTraceEnabled': False},
        ],
    })
    template['Outputs'] = {'ApiUrl': {'Condition': 'IsProductionAccount', 'Value': sub(
        'https://${Api}.execute-api.${AWS::Region}.${AWS::URLSuffix}/production'
    )}}
    return template


if __name__ == '__main__':
    artifact = package()
    digest = hashlib.sha256(artifact).hexdigest()
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    (output / (digest + '.zip')).write_bytes(artifact)
    (ROOT / 'customer-storefront.template.json').write_text(json.dumps(build(), indent=2) + '\n')
    print(digest)
