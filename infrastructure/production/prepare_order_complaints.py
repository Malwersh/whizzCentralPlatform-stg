"""Package the published staging customer complaint workflow for the production account."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import REPO, allow, attr, ref, sub, table
from prepare_merchant_profile import build as profile
from prepare_order_financial_runtime import dynamodb
from prepare_support_storage import BUCKET

NAME = 'wizz-production-order-complaints'


def build():
    template = profile()
    template['Description'] = 'Customer post-delivery complaints and staff review on production keys.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'order-complaints/[a-f0-9]{64}[.]zip'
    resources = template['Resources'] = {
        key: template['Resources'][key] for key in ('LogGroup', 'Role', 'Function', 'Api', 'Deployment', 'Stage')
    }

    def add(key, kind, **properties):
        resources[key] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': properties}

    log = '/aws/lambda/' + NAME
    resources['LogGroup']['Properties']['LogGroupName'] = log
    table_access = (
        ('Orders', ('GetItem', 'ConditionCheckItem'), ('ORDER#*',)),
        ('AccountDeletion', ('GetItem', 'ConditionCheckItem'), ('ACCOUNT_LIFECYCLE#CUSTOMER#*', 'ORDER_LIFECYCLE#*')),
        ('Customers', ('GetItem', 'ConditionCheckItem'), ()),
        ('PlatformStaff', ('GetItem', 'ConditionCheckItem'), ('EMPLOYEE#*', 'OPERATIONAL_SETTINGS#ORDER_EXCEPTION_CASES')),
        ('PlatformStaff', ('PutItem',), ('AUDIT#*',)),
        ('Holds', ('GetItem', 'ConditionCheckItem', 'PutItem'), ()),
        ('SupportChatSessions', ('GetItem', 'ConditionCheckItem', 'PutItem'), ('complaint_*',)),
        ('SupportAttachments', ('GetItem', 'PutItem'), ()),
        ('SupportChatMessages', ('GetItem', 'ConditionCheckItem'), ('complaint_*',)),
        ('WalletLifecycle', ('GetItem', 'PutItem'), ('EXCEPTION_CASE#*',)),
        ('WalletNotifications', ('PutItem',), ('CN:*',)),
        ('PlatformDiscounts', ('GetItem', 'ConditionCheckItem', 'Scan'), ()),
        ('OfferJourney', ('GetItem', 'ConditionCheckItem', 'PutItem'), ('USER#*',)),
    )
    statements = [
        allow(['logs:CreateLogStream', 'logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
        allow('cognito-idp:AdminGetUser', sub(
            'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_njh6vaNWj')),
        allow('dynamodb:Query', sub(table('Orders')['Fn::Sub'] + '/index/GSI_OrderNumber')),
        allow('dynamodb:Query', sub(table('WalletLifecycle')['Fn::Sub'] + '/index/ByDue'),
              {'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['ORDER_EXCEPTIONS_OPEN','ORDER_EXCEPTIONS_CLOSED']},
               'Null':{'dynamodb:LeadingKeys':'false'}}),
        allow('s3:GetObject', sub('arn:${AWS::Partition}:s3:::' + BUCKET + '/support-images/*')),
        allow(['s3:GetObject', 's3:PutObject'], sub('arn:${AWS::Partition}:s3:::' + BUCKET + '/complaint-evidence/*')),
        *[dynamodb(name, verb, keys) for name, verbs, keys in table_access for verb in verbs],
    ]
    resources['Role']['Properties']['Policies'] = [{'PolicyName':'ProductionComplaintWorkflow',
        'PolicyDocument':{'Version':'2012-10-17','Statement':statements}}]
    resources['Function']['Properties'].update(FunctionName=NAME, Runtime='nodejs22.x', Timeout=25, MemorySize=512,
        Environment={'Variables':{'STAGE':'production','COMPLAINT_API_ID':ref('Api'),
            'COMPLAINT_EVIDENCE_BUCKET':BUCKET,'COMPLAINT_EVIDENCE_BUCKET_OWNER':'746727375268'}})
    resources['Api']['Properties']['Name'] = NAME
    add('Complaints', 'AWS::ApiGateway::Resource', RestApiId=ref('Api'),
        ParentId=attr('Api','RootResourceId'), PathPart='complaints')
    dependencies = []
    for label, path, methods in [('Customer','customer',('POST',)), ('Staff','staff',('GET','POST'))]:
        add(label, 'AWS::ApiGateway::Resource', RestApiId=ref('Api'), ParentId=ref('Complaints'), PathPart=path)
        for verb in methods:
            key = label + verb
            add(key,'AWS::ApiGateway::Method',RestApiId=ref('Api'),ResourceId=ref(label),
                HttpMethod=verb, AuthorizationType='NONE', Integration={'Type':'AWS_PROXY','IntegrationHttpMethod':'POST',
                  'Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')})
            add(key+'Invoke','AWS::Lambda::Permission',Action='lambda:InvokeFunction',FunctionName=ref('Function'),
                Principal='apigateway.amazonaws.com',SourceAccount=ref('AWS::AccountId'),
                SourceArn=sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+verb+'/complaints/'+path))
            dependencies.extend((key,key+'Invoke'))
    resources['Deployment']['DependsOn'] = dependencies
    return template


if __name__ == '__main__':
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    modules = REPO/'backend/wallet-service/node_modules'
    source = subprocess.check_output([str(modules/'.bin/esbuild'),
        'infrastructure/production/order-complaints.cjs','--bundle','--platform=node','--target=node22',
        '--format=cjs','--keep-names','--log-level=error','--external:@aws-sdk/*'], cwd=REPO, env={**os.environ, 'NODE_PATH': os.pathsep.join(
            map(str, [modules, REPO/'backend/node_modules', REPO/'backend/staff-service/node_modules']))})
    artifact = out/'order-complaints.zip'
    with ZipFile(artifact, 'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)), source, compress_type=ZIP_DEFLATED)
    (out/'order-complaints.template.json').write_text(json.dumps(build(),separators=(',',':'))+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
