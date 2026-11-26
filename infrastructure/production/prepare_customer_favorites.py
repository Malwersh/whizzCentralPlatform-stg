"""Package the isolated production favorite list, check, add and remove operations."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import REPO, allow, attr, ref, sub, table
from prepare_merchant_profile import build as profile
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-customer-favorites'
BASE = '/users/{user_id}/favorites'
ROUTES = (
    ('List', 'GET', BASE, 'Favorites'),
    ('Add', 'POST', BASE, 'Favorites'),
    ('Remove', 'DELETE', BASE+'/{favorite_id}', 'Favorite'),
    ('Check', 'GET', BASE+'/check/{business_id}', 'BusinessId'),
)


def build():
    template = profile()
    template['Description'] = 'Authenticated production customer favorites using the catalog table.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'customer-favorites/[a-f0-9]{64}[.]zip'
    r=template['Resources']={key:template['Resources'][key] for key in (
        'LogGroup','Role','Function','Api','Deployment','Stage')}

    def add(key, kind, **props):
        r[key]={'Type':kind,'Condition':'IsProductionAccount','Properties':props}

    log='/aws/lambda/'+NAME
    r['LogGroup']['Properties']['LogGroupName']=log
    lifecycle=('ACCOUNT_LIFECYCLE#CUSTOMER#*',)
    r['Role']['Properties']['Policies']=[{'PolicyName':'CustomerFavorites','PolicyDocument':{
        'Version':'2012-10-17','Statement':[
            allow(['logs:CreateLogStream','logs:PutLogEvents'],
                  sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')),
            allow('dynamodb:Query',[table('Favorites/index/userId-createdAt-index'),table('Favorites/index/userId-businessId-index')]),
            dynamodb('Favorites','GetItem',('fav_*',)),
            dynamodb('Favorites','PutItem',('fav_*',)),
            dynamodb('Favorites','DeleteItem',('fav_*',)),
            dynamodb('Merchants','GetItem'),
            dynamodb('Customers','GetItem'),
            dynamodb('Customers','ConditionCheckItem'),
            dynamodb('AccountDeletion','GetItem',lifecycle),
            dynamodb('AccountDeletion','ConditionCheckItem',lifecycle),
        ],
    }}]
    r['Function']['Properties'].update(FunctionName=NAME,Runtime='nodejs22.x',Timeout=15,
        Environment={'Variables':{'STAGE':'production','CUSTOMER_FAVORITES_API_ID':ref('Api')}})
    r['Api']['Properties']['Name']=NAME
    for key,parent,path in [
        ('Users',None,'users'),('User','Users','{user_id}'),('Favorites','User','favorites'),
        ('Favorite','Favorites','{favorite_id}'),('CheckResource','Favorites','check'),('BusinessId','CheckResource','{business_id}'),
    ]:
        add(key,'AWS::ApiGateway::Resource',RestApiId=ref('Api'),
            ParentId=ref(parent) if parent else attr('Api','RootResourceId'),PathPart=path)
    deps=[]
    for key,verb,path,node in ROUTES:
        add(key,'AWS::ApiGateway::Method',RestApiId=ref('Api'),ResourceId=ref(node),HttpMethod=verb,
            AuthorizationType='NONE',Integration={'Type':'AWS_PROXY','IntegrationHttpMethod':'POST',
            'Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')})
        add(key+'Invoke','AWS::Lambda::Permission',Action='lambda:InvokeFunction',FunctionName=ref('Function'),
            Principal='apigateway.amazonaws.com',SourceAccount=ref('AWS::AccountId'),
            SourceArn=sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+verb+
                path.replace('{user_id}','*').replace('{favorite_id}','*').replace('{business_id}','*')))
        deps.extend((key,key+'Invoke'))
    r['Deployment']['DependsOn']=deps
    return template


if __name__=='__main__':
    out=Path(sys.argv[1]).resolve()
    out.mkdir(parents=True,exist_ok=True)
    bundle=subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),
        'infrastructure/production/customer-favorites.cjs','--bundle','--platform=node','--target=node22',
        '--format=cjs','--log-level=error','--external:@aws-sdk/*',
    ],cwd=REPO)
    artifact=out/'customer-favorites.zip'
    with ZipFile(artifact,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),bundle,compress_type=ZIP_DEFLATED)
    (out/'customer-favorites.template.json').write_text(json.dumps(build(),separators=(',',':'))+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
