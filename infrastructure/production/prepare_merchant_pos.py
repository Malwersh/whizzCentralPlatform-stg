"""Build the production POS settings service. Provider URLs are deployment inputs."""
import json
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

from prepare_merchant_profile import build as profile


def build():
    t = json.loads(json.dumps(profile()).replace('wizz-production-merchant-profile', 'wizz-production-merchant-pos'))
    r = t['Resources']
    t['Description'] = 'Production owner-only branch POS settings and approved provider connection probe.'
    params = t['Parameters']
    params['ArtifactKey']['AllowedPattern'] = 'merchant-pos/[a-f0-9]{64}[.]zip'
    params['Enabled'] = params.pop('ProfileApiEnabled')
    params['ApprovedEndpoints'] = {'Type': 'String', 'Default': '', 'MaxLength': 2500}
    fn = r['Function']['Properties']
    fn['Environment']['Variables'] = {'ENVIRONMENT': 'production', 'MERCHANT_POS_ENABLED': {'Ref': 'Enabled'},
                                       'MERCHANT_POS_APPROVED_ENDPOINTS': {'Ref': 'ApprovedEndpoints'}}
    role = r['Role']['Properties']['Policies'][0]
    role['PolicyName'] = 'MerchantPosOnly'
    policy = role['PolicyDocument']
    retained = [row for row in policy['Statement'] if 'logs:CreateLogStream' in row['Action'] or 'cognito-idp:AdminGetUser' in row['Action']]

    def allow(actions, table, keys=()):
        row = {'Effect': 'Allow', 'Action': actions, 'Resource': {
            'Fn::Sub': 'arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-' + table}}
        if keys:
            row['Condition'] = {'ForAllValues:StringLike': {'dynamodb:LeadingKeys': list(keys)}}
        return row

    policy['Statement'] = retained + [
        allow(['dynamodb:GetItem', 'dynamodb:ConditionCheckItem'], 'Merchants'),
        allow(['dynamodb:GetItem', 'dynamodb:ConditionCheckItem'], 'AccountDeletion',
              ['ACCOUNT_LIFECYCLE#MERCHANT#*', 'BUSINESS_LIFECYCLE#MERCHANT#*']),
        allow(['dynamodb:GetItem', 'dynamodb:PutItem'], 'MerchantPlatform', ['MERCHANT_POS#*']),
    ]
    r['Auth']['Properties']['PathPart'] = 'businesses'
    r['Business'] = json.loads(json.dumps(r['Profile']))
    r['Business']['Properties']['PathPart'] = '{businessId}'
    r['Profile']['Properties'].update(PathPart='pos-settings', ParentId={'Ref': 'Business'})
    r['Probe'] = json.loads(json.dumps(r['Profile']))
    r['Probe']['Properties'].update(PathPart='test-connection', ParentId={'Ref': 'Profile'})
    for method, resource, verb, path in [('GET', 'Profile', 'GET', 'pos-settings'), ('PUT', 'Profile', 'PUT', 'pos-settings'),
                                         ('POST', 'Probe', 'POST', 'pos-settings/test-connection')]:
        r[method + 'Method'] = json.loads(json.dumps(r['GETMethod']))
        r[method + 'Method']['Properties'].update(HttpMethod=verb, ResourceId={'Ref': resource})
        r[method + 'Invoke'] = json.loads(json.dumps(r['GETInvoke']))
        r[method + 'Invoke']['Properties']['SourceArn'] = {'Fn::Sub':
            'arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/' + verb + '/businesses/*/' + path}
    r['Deployment']['DependsOn'] = ['GETMethod', 'PUTMethod', 'POSTMethod']
    return t


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[2]
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    bundled = subprocess.check_output([str(root / 'backend/wallet-service/node_modules/.bin/esbuild'),
        'infrastructure/production/merchant-pos/runtime.cjs', '--bundle', '--platform=node', '--target=node22',
        '--format=cjs', '--external:@aws-sdk/*'], cwd=root)
    with ZipFile(output / 'merchant-pos.zip', 'w', ZIP_DEFLATED) as archive:
        archive.writestr('index.js', bundled)
    (output / 'merchant-pos.template.json').write_text(json.dumps(build(), indent=2) + '\n')
