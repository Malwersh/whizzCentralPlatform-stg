"""Package the production merchant's confirm and reject API."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import REPO, allow, attr, ref, sub
from prepare_merchant_response import build as worker
from prepare_merchant_profile import build as profile

NAME = 'wizz-production-merchant-order-responses'


def build(include_orders=False):
    template = worker()
    template['Description'] = 'Authenticated production merchant order confirmation and rejection.'
    template['Parameters'].pop('OrdersStreamArn')
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'merchant-order-responses/[a-f0-9]{64}[.]zip'
    resources = template['Resources']
    for key in ['Due', 'DuePermission', 'OrderInserts']:
        del resources[key]
    function = resources.pop('Worker')
    resources['Function'] = function
    function['Properties'].update(FunctionName=NAME, Timeout=15)
    log = '/aws/lambda/' + NAME
    resources['LogGroup']['Properties']['LogGroupName'] = log
    policy = resources['Role']['Properties']['Policies'][0]
    policy['PolicyName'] = 'MerchantOrderResponses'
    s = policy['PolicyDocument']['Statement']
    s.pop()
    s.pop()
    s[0]['Resource'] = sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')
    s[:] = [entry for entry in s if not (entry['Action'] == 'dynamodb:UpdateItem' and
            isinstance(entry['Resource'], dict) and entry['Resource'].get('Fn::Sub', '').endswith('/wizz-production-Merchants'))]
    pool = 'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_2sKZ4fGbZ'
    s.append(allow('cognito-idp:AdminGetUser', sub(pool)))
    base = profile()['Resources']
    for key in ['Api', 'Authorizer', 'Deployment', 'Stage']:
        resources[key] = base[key]
    resources['Api']['Properties']['Name'] = NAME

    def add(name, kind, properties, **extra):
        resources[name] = {'Type':kind, 'Condition':'IsProductionAccount','Properties':properties, **extra}

    for logical, parent, part in [
        ('Merchant', attr('Api','RootResourceId'), 'merchant'),
        ('Order', ref('Merchant'), 'order'),
        ('OrderID', ref('Order'), '{orderId}'),
        ('Action', ref('OrderID'), '{action}'),
    ]:
        add(logical,'AWS::ApiGateway::Resource',{'RestApiId':ref('Api'),'ParentId':parent,'PathPart':part})
    add('Respond','AWS::ApiGateway::Method',{
        'RestApiId':ref('Api'),'ResourceId':ref('Action'),'HttpMethod':'PUT',
        'AuthorizationType':'COGNITO_USER_POOLS','AuthorizerId':ref('Authorizer'),
        'Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST',
            'Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')},
    })
    add('RespondInvoke','AWS::Lambda::Permission',{
        'Action':'lambda:InvokeFunction','FunctionName':ref('Function'),'Principal':'apigateway.amazonaws.com',
        'SourceAccount':ref('AWS::AccountId'),
        'SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/PUT/merchant/order/*/*'),
    })
    resources['Deployment']['DependsOn'] = ['Respond','RespondInvoke']
    if include_orders:
        from prepare_customer_storefront import table
        s.append(allow('dynamodb:Query', table('Orders/index/GSI_BusinessId')))
        add('Orders','AWS::ApiGateway::Resource',{'RestApiId':ref('Api'),'ParentId':ref('Merchant'),'PathPart':'orders'})
        add('Business','AWS::ApiGateway::Resource',{'RestApiId':ref('Api'),'ParentId':ref('Orders'),'PathPart':'{businessId}'})
        method = {**resources['Respond']['Properties'], 'ResourceId':ref('Business'), 'HttpMethod':'GET'}
        add('ListOrders','AWS::ApiGateway::Method',method)
        permission = {**resources['RespondInvoke']['Properties'],
            'SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/GET/merchant/orders/*')}
        add('ListOrdersInvoke','AWS::Lambda::Permission',permission)
        resources['OrdersDeployment'] = resources.pop('Deployment')
        resources['OrdersDeployment']['DependsOn'] += ['ListOrders','ListOrdersInvoke']
        resources['Stage']['Properties']['DeploymentId'] = ref('OrdersDeployment')
    template['Outputs'] = {'ApiUrl':{'Condition':'IsProductionAccount',
        'Value':sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/production')}}
    return template


if __name__ == '__main__':
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    entry = subprocess.check_output([
        str(REPO / 'backend/wallet-service/node_modules/.bin/esbuild'),
        'backend/wallet-service/src/productionMerchantOrderResponses.ts', '--bundle', '--platform=node',
        '--target=node22','--format=cjs','--log-level=error','--external:@aws-sdk/*',
    ], cwd=REPO)
    archive = output/'merchant-order-responses.zip'
    with ZipFile(archive, 'w') as zipper:
        zipper.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),entry,compress_type=ZIP_DEFLATED)
    (output/'merchant-order-responses.template.json').write_text(json.dumps(build(include_orders=True),indent=2)+'\n')
    print(hashlib.sha256(archive.read_bytes()).hexdigest())
