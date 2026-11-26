"""Package the production catalog and working-hours routes for paired branch devices."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import REPO, allow, attr, ref, sub, table
from prepare_merchant_catalog import build as base_catalog
from prepare_customer_delivery_quotes import leading

NAME = 'wizz-production-branch-device-operations'
ROOT = Path(__file__).resolve().parent


def build():
    source = base_catalog()
    catalog = source['Resources']
    names = ('LogGroup', 'Role', 'Function', 'Api', 'Deployment', 'Stage')
    r = {key: catalog[key] for key in names}
    source['Resources'] = r
    source['Description'] = 'Catalog and working hours for paired merchant devices in production.'
    source['Parameters']['ArtifactKey']['AllowedPattern'] = 'branch-device-operations/[a-f0-9]{64}[.]zip'
    log = '/aws/lambda/' + NAME
    r['LogGroup']['Properties']['LogGroupName'] = log
    r['Api']['Properties']['Name'] = NAME
    function = r['Function']['Properties']
    function.update(FunctionName=NAME, Timeout=28)
    env = function['Environment']['Variables']
    del env['BUSINESS_PHOTOS_BUCKET']
    env.update(MERCHANT_STAFF_PERMISSION_MODE='CENTRAL',
               PRODUCT_IMAGES_ORIGIN='https://kpieztr34c.execute-api.us-east-1.amazonaws.com/production/media')

    def ddb(actions, names, keys=(), transactional=False):
        condition = leading(*keys) if keys else {}
        if transactional:
            condition['StringEquals'] = {'dynamodb:EnclosingOperation': 'TransactWriteItems'}
        return allow(['dynamodb:'+action for action in actions], [table(name) for name in names], condition)

    role = r['Role']['Properties']['Policies'][0]
    role['PolicyName'] = 'BranchDeviceCatalogAndHours'
    role['PolicyDocument']['Statement'] = [
        allow(['logs:CreateLogStream','logs:PutLogEvents'], sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')),
        ddb(('GetItem',), ('Merchants','WorkingHours','Products','MenuCategories')),
        ddb(('Scan',), ('Products','MenuCategories')),
        ddb(('Query',), ('Products/index/BusinessIdIndex',)),
        ddb(('ConditionCheckItem',), ('Merchants','Products','MenuCategories'), transactional=True),
        ddb(('UpdateItem',), ('Merchants',), transactional=True),
        ddb(('PutItem',), ('WorkingHours','Products'), transactional=True),
        ddb(('UpdateItem','DeleteItem'), ('Products',), transactional=True),
        ddb(('GetItem',), ('AccountDeletion',), ('ACCOUNT_LIFECYCLE#MERCHANT#*','BUSINESS_LIFECYCLE#MERCHANT#*')),
        ddb(('ConditionCheckItem',), ('AccountDeletion',), ('ACCOUNT_LIFECYCLE#MERCHANT#*','BUSINESS_LIFECYCLE#MERCHANT#*'), transactional=True),
        ddb(('GetItem',), ('MerchantPlatform',), ('BRANCH#*',)),
        ddb(('ConditionCheckItem','PutItem','UpdateItem'), ('MerchantPlatform',), ('BRANCH#*',), transactional=True),
        ddb(('GetItem',), ('PlatformStaff',), ('HOME_DISCOVERY','OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS')),
        ddb(('ConditionCheckItem',), ('PlatformStaff',), ('HOME_DISCOVERY','OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS'), transactional=True),
    ]

    def add(name, kind, **properties):
        r[name] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': properties}

    def resource(name, parent, segment):
        add(name, 'AWS::ApiGateway::Resource', RestApiId=ref('Api'), ParentId=parent, PathPart=segment)

    resource('Device', attr('Api','RootResourceId'), 'branch-device')
    for key, parent, path in [('Products','Device','products'), ('Product','Products','{productId}'),
                              ('Categories','Device','categories'), ('Businesses','Device','businesses'),
                              ('Branch','Businesses','{businessId}'), ('Hours','Branch','working-hours')]:
        resource(key, ref(parent), path)

    deps = []
    for name, path, methods in [('Products','products',['GET','POST']), ('Product','products/*',['GET','PUT','DELETE']),
                                ('Categories','categories',['GET']), ('Hours','businesses/*/working-hours',['GET','PUT'])]:
        for verb in methods:
            method = name + verb
            add(method, 'AWS::ApiGateway::Method', RestApiId=ref('Api'), ResourceId=ref(name),
                HttpMethod=verb, AuthorizationType='NONE', Integration={'Type':'AWS_PROXY','IntegrationHttpMethod':'POST',
                    'Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')})
            add(method+'Invoke', 'AWS::Lambda::Permission', Action='lambda:InvokeFunction', FunctionName=ref('Function'),
                Principal='apigateway.amazonaws.com', SourceAccount=ref('AWS::AccountId'), SourceArn=sub(
                    'arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+verb+'/branch-device/'+path))
            deps.extend((method, method+'Invoke'))
    r['Deployment']['DependsOn'] = deps
    return source


if __name__ == '__main__':
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    modules = REPO/'backend/wallet-service/node_modules'
    code = subprocess.check_output([str(modules/'.bin/esbuild'), str(ROOT/'branch-device-operations/index.cjs'),
        '--bundle','--platform=node','--target=node22','--format=cjs','--keep-names','--log-level=error','--drop:console'],
        cwd=REPO, env={**os.environ,'NODE_PATH':os.pathsep.join(map(str, [modules,REPO/'backend/staff-service/node_modules']))})
    artifact = out/'branch-device-operations.zip'
    with ZipFile(artifact,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),code,compress_type=ZIP_DEFLATED)
    (out/'branch-device-operations.template.json').write_text(json.dumps(build(),separators=(',',':'))+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
