"""Package the staging merchant catalog and expose it with production bindings."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_merchant_profile import build as profile_template
from prepare_customer_storefront import allow, attr, ref, sub, table
from prepare_customer_delivery_quotes import leading

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
NAME = 'wizz-production-merchant-catalog-api'
BUCKET = NAME + '-746727375268'


def package(output):
    modules = REPO / 'backend/wallet-service/node_modules'
    merchant_modules = REPO.parent / 'whizzMerchants-stg/backend'
    node_path = os.pathsep.join(map(str, (modules, merchant_modules / 'node_modules',
                                          merchant_modules / 'functions/products/node_modules')))
    bundle = subprocess.check_output([
        str(modules / '.bin/esbuild'), str(ROOT / 'merchant-catalog/index.cjs'),
        '--bundle', '--platform=node', '--target=node22', '--format=cjs',
        '--keep-names', '--log-level=error', '--drop:console',
    ], cwd=REPO, env={**os.environ, 'NODE_PATH': node_path})
    with ZipFile(output, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), bundle, compress_type=ZIP_DEFLATED)


def build():
    template = profile_template()
    template['Description'] = 'Production merchant catalog compatible with the shared Flutter merchant catalog'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = r'merchant-catalog/[a-f0-9]{64}[.]zip'
    resources = template['Resources']

    def add(key, kind, properties, **attributes):
        resources[key] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': properties, **attributes}

    log = '/aws/lambda/' + NAME
    resources['LogGroup']['Properties']['LogGroupName'] = log
    policy = resources['Role']['Properties']['Policies'][0]
    policy['PolicyName'] = 'MerchantCatalogOnly'
    statements = policy['PolicyDocument']['Statement']
    statements[0]['Resource'] = sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')
    del statements[2:]

    def ddb(actions, names, keys=(), transactional=False):
        condition = leading(*keys) if keys else {}
        if transactional:
            condition['StringEquals'] = {'dynamodb:EnclosingOperation': 'TransactWriteItems'}
        return allow(['dynamodb:' + action for action in actions], [table(name) for name in names], condition)

    lifecycle = ('ACCOUNT_LIFECYCLE#MERCHANT#*', 'BUSINESS_LIFECYCLE#MERCHANT#*')
    upload = ('ACCOUNT_OPERATION#MERCHANT#*',)
    entries = ('Products', 'MenuCategories')
    statements.extend([
        ddb(('GetItem',), ('Merchants', 'GlobalProducts', *entries)),
        ddb(('GetItem',), ('MerchantDiscounts',)),
        ddb(('Query',), ('MerchantDiscounts/index/BusinessIdIndex',)),
        ddb(('PutItem', 'DeleteItem'), ('MerchantDiscounts',), transactional=True),
        ddb(('Scan',), ('Products', 'MenuCategories', 'GlobalProducts')),
        ddb(('Query',), ('Products/index/BusinessIdIndex', 'MenuCategories/index/BusinessTypeIndex',
                         'GlobalProducts/index/BarcodeIndex')),
        ddb(('GetItem',), ('AccountDeletion',), lifecycle),
        ddb(('ConditionCheckItem',), ('AccountDeletion',), lifecycle),
        ddb(('PutItem',), ('AccountDeletion',), upload, transactional=True),
        ddb(('DeleteItem',), ('AccountDeletion',), upload),
        ddb(('GetItem', 'Query'), ('MerchantPlatform',), ('BRANCH#*',)),
        ddb(('GetItem',), ('MerchantPlatform',), ('CAMPAIGN_SHARING_LOCK#MERCHANT#*',)),
        ddb(('ConditionCheckItem',), ('MerchantPlatform',), ('CAMPAIGN_SHARING_LOCK#MERCHANT#*',)),
        ddb(('ConditionCheckItem',), ('MerchantPlatform',), ('BRANCH#*',)),
        ddb(('PutItem', 'UpdateItem'), ('MerchantPlatform',), ('BRANCH#*',), transactional=True),
        ddb(('GetItem',), ('PlatformStaff',), ('HOME_DISCOVERY',)),
        ddb(('ConditionCheckItem',), ('PlatformStaff',), ('HOME_DISCOVERY',)),
        ddb(('GetItem',), ('Orders',), ('ORDER#*',)),
        ddb(('ConditionCheckItem',), ('Orders',), ('ORDER#*',)),
        ddb(('ConditionCheckItem',), ('Merchants', *entries)),
        ddb(('UpdateItem',), ('Merchants',), transactional=True),
        ddb(('PutItem',), entries, transactional=True),
        ddb(('UpdateItem', 'DeleteItem'), ('Products',), transactional=True),
        allow(['s3:PutObject', 's3:GetObject'], sub('arn:${AWS::Partition}:s3:::'+BUCKET+'/merchants/*/product-images/*')),
    ])

    add('ProductImages', 'AWS::S3::Bucket', {
        'BucketName': BUCKET,
        'CorsConfiguration': {'CorsRules': [{
            'AllowedMethods': ['GET', 'HEAD'], 'AllowedOrigins': ['*'], 'AllowedHeaders': ['*'],
        }]},
        'BucketEncryption': {'ServerSideEncryptionConfiguration': [{
            'ServerSideEncryptionByDefault': {'SSEAlgorithm': 'AES256'}}]},
        'OwnershipControls': {'Rules': [{'ObjectOwnership': 'BucketOwnerEnforced'}]},
        'PublicAccessBlockConfiguration': {
            'BlockPublicAcls': True, 'IgnorePublicAcls': True, 'BlockPublicPolicy': True, 'RestrictPublicBuckets': True},
    }, DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
    add('ImageTransportPolicy', 'AWS::S3::BucketPolicy', {'Bucket': ref('ProductImages'), 'PolicyDocument': {
        'Version': '2012-10-17', 'Statement': [{
            'Sid': 'RequireEncryptedTransport', 'Effect': 'Deny', 'Principal': '*', 'Action': 's3:*',
            'Resource': [attr('ProductImages', 'Arn'), sub('${ProductImages.Arn}/*')],
            'Condition': {'Bool': {'aws:SecureTransport': 'false'}}}],
    }})

    func = resources['Function']['Properties']
    func.update(FunctionName=NAME, Timeout=28, MemorySize=512, Handler='index.handler')
    func['Environment']['Variables'] = {
        'ENVIRONMENT': 'production', 'BUSINESS_PHOTOS_BUCKET': ref('ProductImages'),
        'PRODUCT_IMAGES_ORIGIN': sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/production/media'),
        'BUSINESSES_TABLE': 'wizz-production-Merchants', 'PRODUCTS_TABLE': 'wizz-production-Products',
        'CATEGORIES_TABLE': 'wizz-production-MenuCategories', 'GLOBAL_PRODUCTS_TABLE': 'wizz-production-GlobalProducts',
        'DISCOUNTS_TABLE': 'wizz-production-MerchantDiscounts',
        'MERCHANT_PLATFORM_TABLE': 'wizz-production-MerchantPlatform', 'DISCOVERY_TABLE': 'wizz-production-PlatformStaff',
        'INVENTORY_PRODUCTS_TABLE': 'wizz-production-Products', 'INVENTORY_PLATFORM_TABLE': 'wizz-production-MerchantPlatform',
        'INVENTORY_ORDERS_TABLE': 'wizz-production-Orders',
    }
    resources['Api']['Properties']['Name'] = NAME
    for key in ('Auth','Profile','GETMethod','POSTMethod','GETInvoke','POSTInvoke'):
        del resources[key]

    deps = []
    root = attr('Api', 'RootResourceId')
    def resource(key, part, parent=root):
        add(key, 'AWS::ApiGateway::Resource', {'RestApiId': ref('Api'), 'ParentId': parent, 'PathPart': part})

    def methods(key, path, public=False):
        for verb in (('GET','OPTIONS') if public else ('ANY','OPTIONS')):
            method = key + verb
            is_options = verb == 'OPTIONS'
            auth = {'AuthorizationType': 'NONE'} if is_options or public else {
                'AuthorizationType': 'COGNITO_USER_POOLS', 'AuthorizerId': ref('Authorizer')}
            add(method, 'AWS::ApiGateway::Method', {'RestApiId': ref('Api'), 'ResourceId': ref(key),
                'HttpMethod': verb, **auth, 'Integration': {'Type': 'AWS_PROXY', 'IntegrationHttpMethod': 'POST',
                    'Uri': sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')}})
            permission = method + 'Invoke'
            add(permission, 'AWS::Lambda::Permission', {'Action': 'lambda:InvokeFunction', 'FunctionName': ref('Function'),
                'Principal': 'apigateway.amazonaws.com', 'SourceAccount': ref('AWS::AccountId'),
                'SourceArn': sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'
                                 + (verb if public or is_options else '*') + '/'+ path)})
            deps.extend((method, permission))

    for key, part in [('Products','products'), ('Categories','categories'), ('Menu','menu'), ('Discounts','discounts')]:
        resource(key, part)
        if key != 'Menu':
            methods(key,part)
        resource(key+'Path','{proxy+}',ref(key))
        methods(key+'Path',part+'/*')
    resource('Upload','upload')
    resource('ImageUpload','product-image',ref('Upload'))
    methods('ImageUpload','upload/product-image')
    resource('Media','media')
    resource('MediaPath','{proxy+}',ref('Media'))
    methods('MediaPath','media/*',public=True)
    deployment = resources['DiscountsDeployment'] = resources.pop('Deployment')
    deployment['DependsOn'] = deps
    resources['Stage']['Properties']['DeploymentId'] = ref('DiscountsDeployment')
    return template


if __name__ == '__main__':
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    artifact = output / 'merchant-catalog.zip'
    package(artifact)
    (output / 'merchant-catalog.template.json').write_text(json.dumps(build(), separators=(',', ':'))+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
