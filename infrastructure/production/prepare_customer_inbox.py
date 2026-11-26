"""Package the customer notification inbox with production-only access."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import REPO, allow, attr, ref, sub, table
from prepare_merchant_profile import build as profile
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-customer-inbox'
ROUTE = '/wallet/transfers/notifications'


def build():
    template = profile()
    template['Description'] = 'Customer notification list and read state in production.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'customer-inbox/[a-f0-9]{64}[.]zip'
    r = template['Resources'] = {
        key: template['Resources'][key]
        for key in ('LogGroup','Role','Function','Api','Deployment','Stage')
    }

    def add(key, kind, **props):
        r[key] = {'Type': kind, 'Condition': 'IsProductionAccount', 'Properties': props}

    log = '/aws/lambda/' + NAME
    r['LogGroup']['Properties']['LogGroupName'] = log
    lifecycle = ('ACCOUNT_LIFECYCLE#CUSTOMER#*',)
    watermark = ('CUSTOMER_NOTIFICATION_READ#*',)
    read_at = dynamodb('WalletNotifications', 'UpdateItem')
    read_at['Condition'].update({
        'ForAllValues:StringEquals': {'dynamodb:Attributes': ['eventId','readAt','driverId','recipientApp']},
        'Null': {'dynamodb:Attributes':'false'},
        'StringEqualsIfExists': {'dynamodb:ReturnValues':'NONE'},
    })
    preferences = dynamodb('Customers','UpdateItem')
    preferences['Condition'].update({
        'ForAllValues:StringEquals': {'dynamodb:Attributes':[
            'userId','cognitoSub','isActive','isDeleted','deletedAt','deletionRequestId',
            'notification_settings','marketing_consent']},
        'Null':{'dynamodb:Attributes':'false'},
        'StringEqualsIfExists':{'dynamodb:ReturnValues':'NONE'},
    })
    r['Role']['Properties']['Policies'] = [{'PolicyName':'CustomerNotificationInbox',
        'PolicyDocument':{'Version':'2012-10-17','Statement':[
            allow(['logs:CreateLogStream','logs:PutLogEvents'],
                  sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')),
            allow('dynamodb:Query', table('WalletNotifications/index/ByDriver')),
            read_at,
            dynamodb('IdempotencyKeys','GetItem',watermark),
            dynamodb('IdempotencyKeys','UpdateItem',watermark),
            dynamodb('AccountDeletion','GetItem',lifecycle),
            dynamodb('AccountDeletion','ConditionCheckItem',lifecycle),
            dynamodb('Customers','GetItem'),
            dynamodb('Customers','ConditionCheckItem'),
            preferences,
        ]}}]
    r['Function']['Properties'].update(FunctionName=NAME,Runtime='nodejs22.x',Timeout=15,
        Environment={'Variables':{'STAGE':'production','CUSTOMER_INBOX_API_ID':ref('Api')}})
    r['Api']['Properties']['Name'] = NAME
    parent = attr('Api','RootResourceId')
    for key, segment in [('Wallet','wallet'),('Transfers','transfers'),('Notifications','notifications')]:
        add(key,'AWS::ApiGateway::Resource',RestApiId=ref('Api'),ParentId=parent,PathPart=segment)
        parent=ref(key)
    deps=[]
    for method in ('GET','POST'):
        add(method+'Method','AWS::ApiGateway::Method',RestApiId=ref('Api'),ResourceId=ref('Notifications'),
            HttpMethod=method,AuthorizationType='NONE',Integration={'Type':'AWS_PROXY','IntegrationHttpMethod':'POST',
            'Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')})
        add(method+'Invoke','AWS::Lambda::Permission',Action='lambda:InvokeFunction',FunctionName=ref('Function'),
            Principal='apigateway.amazonaws.com',SourceAccount=ref('AWS::AccountId'),
            SourceArn=sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+method+ROUTE))
        deps.extend((method+'Method',method+'Invoke'))
    r['Deployment']['DependsOn']=deps
    return template


if __name__ == '__main__':
    out=Path(sys.argv[1]).resolve()
    out.mkdir(parents=True,exist_ok=True)
    bundle=subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),
        'infrastructure/production/customer-inbox.cjs','--bundle','--platform=node','--target=node22',
        '--format=cjs','--log-level=error','--external:@aws-sdk/*',
    ],cwd=REPO,env={**os.environ,'NODE_PATH':os.pathsep.join(map(str,[
        REPO/'infrastructure/production/driver-review/node_modules',REPO/'backend/wallet-service/node_modules']))})
    artifact=out/'customer-inbox.zip'
    with ZipFile(artifact,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),bundle,compress_type=ZIP_DEFLATED)
    (out/'customer-inbox.template.json').write_text(json.dumps(build(),separators=(',',':'))+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
