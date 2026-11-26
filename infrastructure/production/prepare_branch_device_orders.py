"""Package the production order workflow for paired branch devices."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import REPO, attr, ref, sub
from prepare_merchant_order_responses import build as order_api
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-branch-device-orders'


def build():
    template = order_api(include_orders=True)
    template['Description'] = 'Production branch device order reception and audited employee transitions.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'branch-device-orders/[a-f0-9]{64}[.]zip'
    r = template['Resources']
    r['Api']['Properties']['Name'] = NAME
    r['Function']['Properties'].update(FunctionName=NAME, Timeout=24)
    r['Function']['Properties']['Environment']['Variables']['MERCHANT_STAFF_PERMISSION_MODE'] = 'CENTRAL'
    log = '/aws/lambda/' + NAME
    r['LogGroup']['Properties']['LogGroupName'] = log
    role = r['Role']['Properties']['Policies'][0]
    role['PolicyName'] = 'BranchDeviceOrders'
    grants = role['PolicyDocument']['Statement']
    grants[:] = [grant for grant in grants if grant['Action'] != 'cognito-idp:AdminGetUser']
    grants[0]['Resource'] = sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')
    grants.extend(dynamodb('MerchantPlatform', verb, ('BRANCH#*',))
                  for verb in ('GetItem', 'ConditionCheckItem', 'PutItem'))
    grants.extend(dynamodb('PlatformStaff', verb, ('OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',))
                  for verb in ('GetItem', 'ConditionCheckItem'))

    grouped = {}
    for grant in grants:
        scope = {key: value for key, value in grant.items() if key != 'Action'}
        key = json.dumps(scope, sort_keys=True)
        statement = grouped.setdefault(key, {**scope, 'Action': []})
        actions = grant['Action']
        statement['Action'].extend(actions if isinstance(actions, list) else [actions])
    grants[:] = list(grouped.values())

    del r['Authorizer']
    r['Device'] = {'Type': 'AWS::ApiGateway::Resource', 'Condition': 'IsProductionAccount', 'Properties': {
        'RestApiId': ref('Api'), 'ParentId': attr('Api', 'RootResourceId'), 'PathPart': 'branch-device',
    }}
    r['Merchant']['Properties']['ParentId'] = ref('Device')
    for method in ('Respond', 'ListOrders'):
        r[method]['Properties']['AuthorizationType'] = 'NONE'
        del r[method]['Properties']['AuthorizerId']
        permission = r[method+'Invoke']['Properties']['SourceArn']['Fn::Sub']
        r[method+'Invoke']['Properties']['SourceArn'] = sub(permission.replace('/merchant/', '/branch-device/merchant/'))
    return template


if __name__ == '__main__':
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    code = subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),
        'backend/wallet-service/src/productionBranchDeviceOrders.ts', '--bundle', '--platform=node',
        '--target=node22','--format=cjs','--keep-names','--log-level=error','--external:@aws-sdk/*',
    ], cwd=REPO)
    artifact = out/'branch-device-orders.zip'
    with ZipFile(artifact, 'w') as archive:
        archive.writestr(ZipInfo('index.js', (2026, 1, 1, 0, 0, 0)), code, compress_type=ZIP_DEFLATED)
    (out/'branch-device-orders.template.json').write_text(json.dumps(build(), separators=(',', ':'))+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
