"""Build the staging order-rating contract against production tables and identity."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import REPO, allow, attr, ref, sub
from prepare_merchant_profile import build as profile
from prepare_order_financial_runtime import dynamodb

NAME='wizz-production-order-ratings'
ROUTE='/orders/{orderId}/rating'


def build():
    t=profile()
    t['Description']='Production order ratings with staging-compatible aggregates and driver chronology.'
    t['Parameters']['ArtifactKey']['AllowedPattern']='order-ratings/[a-f0-9]{64}[.]zip'
    r=t['Resources']={k:t['Resources'][k] for k in ('LogGroup','Role','Function','Api','Deployment','Stage')}

    def add(key, kind, **props):
        r[key]={'Type':kind,'Condition':'IsProductionAccount','Properties':props}

    log='/aws/lambda/'+NAME
    r['LogGroup']['Properties']['LogGroupName']=log
    log_policy=allow(['logs:CreateLogStream','logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*'))
    lifecycle=('ACCOUNT_LIFECYCLE#CUSTOMER#*','ACCOUNT_LIFECYCLE#DRIVER#*','BUSINESS_LIFECYCLE#MERCHANT#*')
    rating_keys=('ORDER#*','MERCHANT#*','DRIVER#*')
    statements=[log_policy,
        *[dynamodb('Orders',action,('ORDER#*',)) for action in ('GetItem','ConditionCheckItem')],
        *[dynamodb('Customers',action) for action in ('GetItem','ConditionCheckItem')],
        *[dynamodb('AccountDeletion',action,lifecycle) for action in ('GetItem','ConditionCheckItem')],
        *[dynamodb('OrderRatings',action,rating_keys) for action in ('GetItem','PutItem')],
    ]
    for recipient,key in (('Merchants','businessId'),('Drivers','driverId')):
        statements.append(dynamodb(recipient,'GetItem'))
        policy=dynamodb(recipient,'UpdateItem')
        policy['Condition'].update({
            'ForAllValues:StringEquals': {'dynamodb:Attributes':[
                key,'customerRating','customerRatingCount','customerRatingSum','customerRatingUpdatedAt',
                'isDeleted','deletedAt','deletionRequestId',
            ]},
            'Null': {'dynamodb:Attributes':'false'},
            'StringEqualsIfExists': {'dynamodb:ReturnValues':'NONE'},
        })
        statements.append(policy)
    r['Role']['Properties']['Policies']=[{'PolicyName':'ProductionOrderRatings','PolicyDocument':{
        'Version':'2012-10-17','Statement':statements}}]
    r['Function']['Properties'].update(FunctionName=NAME,Runtime='nodejs22.x',Timeout=20,
        Environment={'Variables':{'STAGE':'production','ORDER_RATINGS_API_ID':ref('Api')}})
    r['Api']['Properties']['Name']=NAME
    parent=attr('Api','RootResourceId')
    for key,path in [('Orders','orders'),('Order','{orderId}'),('Rating','rating')]:
        add(key,'AWS::ApiGateway::Resource',RestApiId=ref('Api'),ParentId=parent,PathPart=path)
        parent=ref(key)
    deps=[]
    for method in ('GET','POST'):
        add(method+'Method','AWS::ApiGateway::Method',RestApiId=ref('Api'),ResourceId=ref('Rating'),
            HttpMethod=method,AuthorizationType='NONE',Integration={'Type':'AWS_PROXY','IntegrationHttpMethod':'POST',
            'Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')})
        add(method+'Invoke','AWS::Lambda::Permission',Action='lambda:InvokeFunction',FunctionName=ref('Function'),
            Principal='apigateway.amazonaws.com',SourceAccount=ref('AWS::AccountId'),
            SourceArn=sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+method+'/orders/*/rating'))
        deps.extend((method+'Method',method+'Invoke'))
    r['Deployment']['DependsOn']=deps
    return t


if __name__=='__main__':
    out=Path(sys.argv[1]).resolve()
    out.mkdir(parents=True,exist_ok=True)
    source=subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),
        'infrastructure/production/order-ratings.cjs','--bundle','--platform=node','--target=node22',
        '--format=cjs','--log-level=error','--external:@aws-sdk/*',
    ],cwd=REPO)
    artifact=out/'order-ratings.zip'
    with ZipFile(artifact,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),source,compress_type=ZIP_DEFLATED)
    (out/'order-ratings.template.json').write_text(json.dumps(build(),separators=(',',':'))+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
