"""Bind the staging campaign editor to the production campaign and code ownership tables."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import REPO, ROOT, allow, attr, ref, sub, table
from prepare_merchant_profile import build as profile
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-platform-campaigns'


def build():
    template = profile()
    template['Description'] = 'Versioned percentage and fixed goods campaigns with production-only staff permissions.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'platform-campaigns/[a-f0-9]{64}[.]zip'
    resources = template['Resources'] = {
        key: template['Resources'][key] for key in ('LogGroup','Role','Function','Api','Deployment','Stage')
    }

    def add(key, kind, **properties):
        resources[key] = {'Type':kind,'Condition':'IsProductionAccount','Properties':properties}

    log = '/aws/lambda/' + NAME
    resources['LogGroup']['Properties']['LogGroupName'] = log
    admin = json.loads((ROOT/'wallet-identity-bindings.json').read_text())['identities']['admin']
    catalogue = ('Merchants','Regions','Products','MenuCategories','PlatformDiscounts')
    staff_scan = {'ForAllValues:StringEquals':{'dynamodb:Attributes':['pk','sk','campaignId','source','schemaVersion']},
        'Null':{'dynamodb:Attributes':'false'},'StringEquals':{'dynamodb:Select':'SPECIFIC_ATTRIBUTES'}}
    statements = [
        allow(['logs:CreateLogStream','logs:PutLogEvents'],
            sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')),
        allow('cognito-idp:AdminGetUser',sub(
            'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/'+admin['poolId'])),
        allow(['dynamodb:GetItem','dynamodb:Scan'],[table(name) for name in catalogue]),
        allow('dynamodb:Scan',table('PlatformStaff'),staff_scan),
        *[dynamodb('PlatformStaff',verb,('EMPLOYEE#*',)) for verb in ('GetItem','ConditionCheckItem')],
        *[dynamodb('MerchantPlatform',verb,('CAMPAIGN_SHARING_LOCK#PLATFORM#*',)) for verb in ('GetItem','ConditionCheckItem')],
        *[dynamodb('PlatformStaff',verb,('OFFER_CODE#*',)) for verb in ('UpdateItem','DeleteItem')],
        dynamodb('PlatformStaff','PutItem',('AUDIT#*',)),
        dynamodb('PlatformDiscounts','UpdateItem'),
        dynamodb('PlatformDiscounts','ConditionCheckItem'),
        *[dynamodb('WalletNotifications',verb,('CAMPAIGN_PUSH#*',)) for verb in ('GetItem','PutItem','UpdateItem')],
        allow(['s3:GetObject','s3:PutObject'],sub(
            'arn:${AWS::Partition}:s3:::wizz-production-home-slides-746727375268/home-slideshow/campaigns-*/*')),
    ]
    resources['Role']['Properties']['Policies'] = [{'PolicyName':'CampaignsProduction',
        'PolicyDocument':{'Version':'2012-10-17','Statement':statements}}]
    resources['Function']['Properties'].update(FunctionName=NAME, Runtime='nodejs22.x', Timeout=25, MemorySize=512,
        Environment={'Variables':{'STAGE':'production','OFFERS_API_ID':ref('Api')}})
    resources['Api']['Properties']['Name'] = NAME
    add('Staff','AWS::ApiGateway::Resource',RestApiId=ref('Api'),ParentId=attr('Api','RootResourceId'),PathPart='staff')
    add('Offers','AWS::ApiGateway::Resource',RestApiId=ref('Api'),ParentId=ref('Staff'),PathPart='offers')
    deps=[]
    for verb in ('GET','POST'):
        key='Offers'+verb
        add(key,'AWS::ApiGateway::Method',RestApiId=ref('Api'),ResourceId=ref('Offers'),HttpMethod=verb,
            AuthorizationType='NONE',Integration={'Type':'AWS_PROXY','IntegrationHttpMethod':'POST',
                'Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')})
        add(key+'Invoke','AWS::Lambda::Permission',Action='lambda:InvokeFunction',FunctionName=ref('Function'),
            Principal='apigateway.amazonaws.com',SourceAccount=ref('AWS::AccountId'),
            SourceArn=sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+verb+'/staff/offers'))
        deps.extend((key,key+'Invoke'))
    resources['Deployment']['DependsOn']=deps
    return template


if __name__=='__main__':
    out=Path(sys.argv[1]).resolve()
    out.mkdir(parents=True,exist_ok=True)
    modules=REPO/'backend/wallet-service/node_modules'
    env={**os.environ,'NODE_PATH':os.pathsep.join(map(str,[modules,REPO/'backend/node_modules',REPO/'backend/staff-service/node_modules']))}
    bundle=subprocess.check_output([str(modules/'.bin/esbuild'),'infrastructure/production/platform-campaigns.cjs',
        '--bundle','--platform=node','--target=node22','--format=cjs','--keep-names','--log-level=error','--external:@aws-sdk/*'],
        cwd=REPO,env=env)
    artifact=out/'platform-campaigns.zip'
    with ZipFile(artifact,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),bundle,compress_type=ZIP_DEFLATED)
    (out/'platform-campaigns.template.json').write_text(json.dumps(build(),separators=(',',':'))+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
