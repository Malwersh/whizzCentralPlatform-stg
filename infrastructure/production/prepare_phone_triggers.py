"""Prepare account-isolated phone triggers; sends remain disabled at deployment."""
import hashlib
import json
import io
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ACCOUNT = '746727375268'

def bundle(application):
    workspace = ROOT.parents[2]
    if application == 'Merchant':
        sources = {'merchant-challenge': ROOT / 'phone-auth/merchant-challenge.js', 'runtime': ROOT / 'phone-auth/index.js', **{name:ROOT/'phone-auth'/name for name in ['merchant-login-proof.cjs','merchant-enrollment.cjs','merchant-enrollment-store.cjs']}}
    else:
        repo = 'wizzuser-stg' if application == 'Customer' else 'whizzDrivers-stg'
        base = workspace / repo / 'backend/phone-auth'
        sources = {name: base / (name + '.js') for name in ['challenge-policy', 'login-proof', 'triggers']}
        if application == 'Driver':
            sources['iraqi-phone'] = base / 'iraqi-phone.js'
    code = "'use strict';\nconst nativeRequire = require;\nconst factories = {\n"
    evidence = []
    for name, path in sources.items():
        text = path.read_text()
        evidence.append({'module': name, 'sha256': hashlib.sha256(text.encode()).hexdigest()})
        code += json.dumps(name) + ': function(module, exports, require) {\n' + text + '\n},\n'
    code += """};
const cache = {};
function load(name) {
  if (!name.startsWith('./')) return nativeRequire(name);
  const id = name.slice(2);
  if (!Object.hasOwn(factories, id)) throw Error('Unknown bundled module');
  if (!cache[id]) {
    const module = {exports: {}};
    cache[id] = module;
    factories[id](module, module.exports, load);
  }
  return cache[id].exports;
}
"""
    entry = 'runtime' if application == 'Merchant' else 'triggers'
    code += f"const application = load('./{entry}');\n"
    code += """exports.handler = async event => {
  if (process.env.ENVIRONMENT !== 'production' || process.env.OTP_ENABLED !== 'true' ||
      !process.env.USER_POOL_ID || !process.env.OTP_TABLE || !process.env.OTP_SECRET_ARN ||
      event.userPoolId !== process.env.USER_POOL_ID) throw Error('OTP configuration unavailable');
  return application.handler(event);
};
"""
    return code, evidence


def build():
    base = json.loads((ROOT / 'storage-auth.template.json').read_text())
    template = {k: v for k, v in base.items() if k not in ('Resources', 'Outputs')}
    template['Description'] = 'Production phone challenge functions. OTP delivery disabled; no public endpoints.'
    template['Parameters'].update(MerchantArtifactKey={'Type':'String','AllowedPattern':'merchant-phone-trigger/[a-f0-9]{64}.zip'}, MerchantArtifactVersion={'Type':'String','MinLength':1})
    template['Resources'] = {}
    template['Outputs'] = {}
    identities = json.loads((ROOT.parent.parent / 'docs/production-identity-phone-verification-2026-11-15.json').read_text())
    assert identities['accountId'] == ACCOUNT and identities['stackStatus'] == 'CREATE_COMPLETE'
    pools = {x['application']: x['poolId'] for x in identities['identities']}
    metadata = {'accountId': ACCOUNT, 'otpEnabled': False, 'apiEndpointsCreated': False, 'applications': []}
    def resource(name, kind, props, retained=False):
        item = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': props}
        if retained:
            item.update(DeletionPolicy='Retain', UpdateReplacePolicy='Retain')
        template['Resources'][name] = item
    merchant_schema = json.loads((ROOT / 'storage-auth.template.json').read_text())['Resources']['DriverOtpSessionsTable']['Properties']
    merchant_schema['TableName'] = 'wizz-production-MerchantOtpSessions'
    resource('MerchantOtpSessionsTable', 'AWS::DynamoDB::Table', merchant_schema, True)
    for role in ['Customer', 'Driver', 'Merchant']:
        app = role.lower()
        pool_param = role + 'PoolId'
        template['Parameters'][pool_param] = {'Type': 'String', 'Default': pools[role], 'AllowedValues': [pools[role]]}
        template['Parameters'][role + 'OtpEnabled'] = {
            'Type': 'String', 'Default': 'false', 'AllowedValues': ['false', 'true']
        }
        function_name = 'wizz-production-' + app + '-phone-challenge'
        table_name = 'wizz-production-' + {'Customer': 'CustomerPhoneAuth', 'Driver': 'DriverOtpSessions', 'Merchant': 'MerchantOtpSessions'}[role]
        pool_arn = {'Fn::Sub': f'arn:${{AWS::Partition}}:cognito-idp:${{AWS::Region}}:${{AWS::AccountId}}:userpool/${{{pool_param}}}'}
        resource(role + 'OtpSecret', 'AWS::SecretsManager::Secret', {
            'Name': 'wizz/production/' + app + '/otp',
            'Description': 'Fresh HMAC key; provider API key must be configured before activation.',
            'GenerateSecretString': {'SecretStringTemplate': json.dumps({'apiKey': '', 'configurationStatus': 'PRODUCTION_PROVIDER_REQUIRED'}),
                                     'GenerateStringKey': 'hmacKey', 'PasswordLength': 64, 'ExcludePunctuation': True},
            'Tags': [{'Key': 'Environment', 'Value': 'production'}],
        }, True)
        log_name = '/aws/lambda/' + function_name
        resource(role + 'ChallengeLogGroup', 'AWS::Logs::LogGroup', {'LogGroupName': log_name, 'RetentionInDays': 90}, True)
        statements = [
            {'Effect': 'Allow', 'Action': ['logs:CreateLogStream', 'logs:PutLogEvents'],
             'Resource': {'Fn::Sub': 'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log_name + ':*'}},
            {'Effect': 'Allow', 'Action': ['dynamodb:GetItem', 'dynamodb:UpdateItem'] + ([] if role == 'Customer' else ['dynamodb:PutItem']),
             'Resource': {'Fn::Sub': 'arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/' + table_name}},
            {'Effect': 'Allow', 'Action': ['secretsmanager:GetSecretValue'], 'Resource': {'Ref': role + 'OtpSecret'}},
        ]
        if role == 'Merchant':
            statements.append({'Effect':'Allow','Action':['dynamodb:ConditionCheckItem'],'Resource':{'Fn::Sub':'arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/'+table_name}})
            statements.append({'Effect':'Allow','Action':['dynamodb:ConditionCheckItem'],'Resource':{'Fn::Sub':'arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-AccountDeletion'},'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ACCOUNT_LIFECYCLE#MERCHANT#*']}}})
        if role == 'Driver':
            statements.append({'Effect': 'Allow', 'Action': ['cognito-idp:AdminUpdateUserAttributes'], 'Resource': pool_arn})
        resource(role + 'ChallengeRole', 'AWS::IAM::Role', {
            'AssumeRolePolicyDocument': {'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole'}]},
            'Policies': [{'PolicyName': 'ProductionPhoneChallengeOnly', 'PolicyDocument': {'Version': '2012-10-17', 'Statement': statements}}],
        })
        code, evidence = bundle(role)
        resource(role + 'ChallengeFunction', 'AWS::Lambda::Function', {
            'FunctionName': function_name, 'Runtime': 'nodejs22.x', 'Handler': 'index.handler',
            'MemorySize': 256, 'Timeout': 10,
            'Role': {'Fn::GetAtt': [role + 'ChallengeRole', 'Arn']}, 'Code': ({'S3Bucket':'wizz-production-artifacts-746727375268-us-east-1','S3Key':{'Ref':'MerchantArtifactKey'},'S3ObjectVersion':{'Ref':'MerchantArtifactVersion'}} if role == 'Merchant' else {'ZipFile':code}),
            'Environment': {'Variables': {'ENVIRONMENT': 'production', 'OTP_ENABLED': {'Ref': role + 'OtpEnabled'},
                            'USER_POOL_ID': {'Ref': pool_param}, 'OTP_TABLE': table_name, 'OTP_SECRET_ARN': {'Ref': role + 'OtpSecret'}}},
            'LoggingConfig': {'LogGroup': {'Ref': role + 'ChallengeLogGroup'}},
            'Tags': [{'Key': 'Environment', 'Value': 'production'}],
        })
        if role == 'Merchant':
            template['Resources'][role + 'ChallengeFunction']['DependsOn'] = 'MerchantOtpSessionsTable'
            template['Resources'][role+'ChallengeFunction']['Properties']['Environment']['Variables']['USER_POOL_CLIENT_ID']='5l8ng11uudg146crop63926svq'
        resource(role + 'CognitoInvoke', 'AWS::Lambda::Permission', {
            'Action': 'lambda:InvokeFunction', 'FunctionName': {'Ref': role + 'ChallengeFunction'},
            'Principal': 'cognito-idp.amazonaws.com', 'SourceAccount': {'Ref': 'AWS::AccountId'}, 'SourceArn': pool_arn,
        })
        template['Outputs'][role + 'ChallengeArn'] = {'Value': {'Fn::GetAtt': [role + 'ChallengeFunction', 'Arn']}}
        metadata['applications'].append({'application': role, 'poolId': pools[role], 'table': table_name, 'functionName': function_name, 'sourceModules': evidence})
    return template, metadata

def merchant_package():
    raw=bundle('Merchant')[0].encode()
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        info=zipfile.ZipInfo('index.js',date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,raw)
    return out.getvalue()

if __name__ == '__main__':
    raw=merchant_package();digest=hashlib.sha256(raw).hexdigest()
    Path('/private/tmp/wizz-production-merchant-phone-trigger-'+digest+'.zip').write_bytes(raw)
    (ROOT/'phone-auth/merchant-trigger-bundle.js').write_text(bundle('Merchant')[0])
    print(json.dumps({'sha256':digest,'status':'PREPARED_DISABLED_NOT_DEPLOYED'}))
    template, metadata = build()
    (ROOT / 'phone-triggers.template.json').write_text(json.dumps(template, indent=2) + '\n')
    (ROOT / 'phone-triggers-map.json').write_text(json.dumps(metadata, indent=2) + '\n')
