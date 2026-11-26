"""Build the production merchant setup API template and artifact."""
import hashlib
import io
import json
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path
from prepare_merchant_profile import build as profile_template

ROOT = Path(__file__).resolve().parent

def build():
    template = profile_template()
    template['Description'] = 'Production merchant menu publication, working hours, and branch activation'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'merchant-setup/[a-f0-9]{64}.zip'
    resources = template['Resources']
    log = '/aws/lambda/wizz-production-merchant-setup'
    resources['LogGroup']['Properties']['LogGroupName'] = log
    policy = resources['Role']['Properties']['Policies'][0]
    policy['PolicyName'] = 'MerchantBranchSetup'
    statements = policy['PolicyDocument']['Statement']
    statements[0]['Resource']['Fn::Sub'] = 'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*'
    del statements[2:]
    def table(name):
        return {'Fn::Sub': 'arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-' + name}
    def grant(actions, names, keys=(), transaction=False):
        condition = {}
        if keys:
            condition['ForAllValues:StringLike'] = {'dynamodb:LeadingKeys': list(keys)}
            condition['Null'] = {'dynamodb:LeadingKeys': 'false'}
        if transaction:
            condition['StringEquals'] = {'dynamodb:EnclosingOperation': 'TransactWriteItems'}
        statements.append({
            'Effect': 'Allow', 'Action': ['dynamodb:' + x for x in actions],
            'Resource': [table(n) for n in names], **({'Condition': condition} if condition else {}),
        })
    grant(['GetItem', 'Query'], ['MerchantPlatform'], ['BRANCH#*'])
    grant(['GetItem'], ['MerchantPlatform'], ['PERSON#*'])
    grant(['ConditionCheckItem'], ['MerchantPlatform'], ['BRANCH#*', 'PERSON#*'], transaction=True)
    grant(['PutItem'], ['MerchantPlatform'], ['BRANCH#*'], transaction=True)
    grant(['GetItem'], ['AccountDeletion'], ['ACCOUNT_LIFECYCLE#MERCHANT#*','BUSINESS_LIFECYCLE#MERCHANT#*'])
    grant(['ConditionCheckItem'], ['AccountDeletion'], ['ACCOUNT_LIFECYCLE#MERCHANT#*','BUSINESS_LIFECYCLE#MERCHANT#*'], transaction=True)
    grant(['GetItem'], ['PlatformStaff'], ['HOME_DISCOVERY'])
    grant(['ConditionCheckItem'], ['PlatformStaff'], ['HOME_DISCOVERY'], transaction=True)
    grant(['GetItem'], ['Merchants', 'Products', 'MenuCategories', 'WorkingHours', 'Regions', 'RegionsDerived', 'RegionIndex'])
    grant(['Query'], ['RegionIndex/index/h3-index'])
    grant(['ConditionCheckItem'], ['Merchants','Products','MenuCategories','WorkingHours','Regions','RegionsDerived'], transaction=True)
    grant(['PutItem'], ['Products','MenuCategories','WorkingHours'], transaction=True)
    grant(['UpdateItem'], ['Merchants'], transaction=True)

    function = resources['Function']['Properties']
    function.update(FunctionName='wizz-production-merchant-setup', Timeout=27)
    function['Environment']['Variables'] = {
        'ENVIRONMENT': 'production', 'PLATFORM_ENVIRONMENT': 'production',
        'MERCHANT_PLATFORM_TABLE': 'wizz-production-MerchantPlatform',
        'PRODUCTS_TABLE': 'wizz-production-Products', 'CATEGORIES_TABLE': 'wizz-production-MenuCategories',
        'BUSINESSES_TABLE': 'wizz-production-Merchants', 'DISCOVERY_TABLE': 'wizz-production-PlatformStaff',
    }
    resources['Api']['Properties']['Name'] = 'wizz-production-merchant-setup'
    resources['Profile']['Properties']['PathPart'] = 'branch-setup'
    for verb in ('GET', 'POST'):
        resources[verb+'Invoke']['Properties']['SourceArn']['Fn::Sub'] = resources[verb+'Invoke']['Properties']['SourceArn']['Fn::Sub'].replace('/person-profile','/branch-setup')
    resources['OPTIONSMethod'] = json.loads(json.dumps(resources['GETMethod']))
    options = resources['OPTIONSMethod']['Properties']
    options.update(HttpMethod='OPTIONS', AuthorizationType='NONE')
    del options['AuthorizerId']
    resources['OPTIONSInvoke'] = json.loads(json.dumps(resources['GETInvoke']))
    options_source = resources['OPTIONSInvoke']['Properties']['SourceArn']
    options_source['Fn::Sub'] = options_source['Fn::Sub'].replace('/GET/','/OPTIONS/')
    resources['Deployment']['DependsOn'].append('OPTIONSMethod')
    return template

def package():
    modules = ROOT.parents[1] / 'backend/wallet-service/node_modules'
    with tempfile.TemporaryDirectory(prefix='wizz-merchant-setup-') as tmp:
        output = Path(tmp) / 'index.cjs'
        subprocess.run([str(modules / '.bin/esbuild'), str(ROOT / 'merchant-setup/index.cjs'), '--bundle',
                        '--platform=node', '--format=cjs', '--target=node22', '--outfile=' + str(output), '--log-level=error'],
                       env={**os.environ, 'NODE_PATH': str(modules)}, check=True)
        result = io.BytesIO()
        with zipfile.ZipFile(result, 'w', zipfile.ZIP_DEFLATED) as archive:
            info = zipfile.ZipInfo('index.cjs', date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, output.read_bytes())
        return result.getvalue()

if __name__ == '__main__':
    raw = package()
    digest = hashlib.sha256(raw).hexdigest()
    target = Path('/private/tmp') / ('wizz-production-merchant-setup-' + digest + '.zip')
    target.write_bytes(raw)
    (ROOT / 'merchant-setup-api.template.json').write_text(json.dumps(build(), indent=2) + '\n')
    print(json.dumps({'artifact': str(target), 'sha256': digest}))
