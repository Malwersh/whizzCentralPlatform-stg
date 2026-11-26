"""Bind the verified Staging support protocol to Production identities and storage."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import REPO, allow, attr, ref, sub, table
from prepare_merchant_profile import build as profile
from prepare_customer_delivery_quotes import leading
from prepare_support_storage import BUCKET

NAME='wizz-production-support-chat'
PORTAL='https://production.dy2cvcjvju3cf.amplifyapp.com'
SUPPORT={
    'WEBSOCKET_CONNECTIONS_TABLE':'SupportConnections','WEBSOCKET_SUBSCRIPTIONS_TABLE':'SupportSubscriptions',
    'CHAT_SESSIONS_TABLE':'SupportChatSessions','CHAT_MESSAGES_TABLE':'SupportChatMessages',
    'SUPPORT_MESSAGE_RECEIPTS_TABLE':'SupportMessageReceipts','SUPPORT_ATTACHMENTS_TABLE':'SupportAttachments',
    'SUPPORT_BUSINESSES_TABLE':'Merchants','SUPPORT_MEMBERSHIPS_TABLE':'MerchantPlatform',
    'SUPPORT_CUSTOMER_ORDERS_TABLE':'Orders','SUPPORT_CUSTOMER_PROFILES_TABLE':'Customers',
    'SUPPORT_SETTINGS_TABLE':'PlatformStaff','SUPPORT_LIFECYCLE_TABLE':'AccountDeletion',
    'WALLET_NOTIFICATIONS_TABLE':'WalletNotifications','SUPPORT_COMPLAINT_CASES_TABLE':'Holds',
}


def build():
    template=profile()
    template['Description']='Wizz production authenticated support chat, short-lived staff tickets and private images.'
    template['Parameters'].pop('ProfileApiEnabled', None)
    template['Parameters']['ArtifactKey']['AllowedPattern']='support-chat/[a-f0-9]{64}[.]zip'
    r=template['Resources']={key:template['Resources'][key] for key in ('LogGroup','Role','Function','Api','Deployment','Stage')}

    def add(name,kind,**properties):
        r[name]={'Type':kind,'Condition':'IsProductionAccount','Properties':properties}

    def ddb(actions,tables,keys=()):
        return allow(['dynamodb:'+action for action in actions],[table(name) for name in tables],leading(*keys) if keys else {})

    log='/aws/lambda/'+NAME
    r['LogGroup']['Properties']['LogGroupName']=log
    r['Role']['Properties']['Policies']=[{'PolicyName':'SupportChatOnly','PolicyDocument':{'Version':'2012-10-17','Statement':[
        allow(['logs:CreateLogStream','logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')),
        allow('cognito-idp:AdminGetUser',
              sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_njh6vaNWj')),
        ddb(('GetItem','PutItem','UpdateItem','DeleteItem','Scan'),('SupportConnections',)),
        ddb(('PutItem','DeleteItem'),('SupportSubscriptions',),('TICKET#*',)),
        ddb(('GetItem','PutItem','UpdateItem','Scan'),('SupportChatSessions',)),
        ddb(('ConditionCheckItem',),('SupportChatSessions',)),
        ddb(('GetItem','PutItem','Query'),('SupportChatMessages',)),
        ddb(('GetItem','PutItem'),('SupportMessageReceipts',)),
        ddb(('GetItem','PutItem','UpdateItem'),('SupportAttachments',)),
        ddb(('PutItem',),('WalletNotifications',),('CN:*',)),
        ddb(('GetItem',),('Merchants','Customers')),
        ddb(('GetItem',),('Orders',),('ORDER#*',)),
        ddb(('GetItem',),('MerchantPlatform',),('BRANCH#*',)),
        ddb(('GetItem',),('AccountDeletion',),('ACCOUNT_LIFECYCLE#CUSTOMER#*','ACCOUNT_LIFECYCLE#DRIVER#*',
            'ACCOUNT_LIFECYCLE#MERCHANT#*','BUSINESS_LIFECYCLE#MERCHANT#*')),
        ddb(('ConditionCheckItem',),('AccountDeletion',),('ACCOUNT_LIFECYCLE#CUSTOMER#*',)),
        ddb(('GetItem',),('PlatformStaff',),('EMPLOYEE#*','OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS')),
        ddb(('GetItem',),('Holds',)),
        allow('s3:GetObject',sub('arn:${AWS::Partition}:s3:::'+BUCKET+'/complaint-evidence/*')),
        allow(['s3:PutObject','s3:GetObject'],sub('arn:${AWS::Partition}:s3:::'+BUCKET+'/support-images/*')),
        allow('execute-api:ManageConnections',sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Socket}/production/POST/@connections/*')),
    ]}}]
    r['Function']['Properties'].update(FunctionName=NAME,Runtime='nodejs22.x',Timeout=30,MemorySize=512,
        Environment={'Variables':{**{key:'wizz-production-'+name for key,name in SUPPORT.items()},
            'SUPPORT_BUCKET_OWNER':'746727375268','SUPPORT_ATTACHMENTS_BUCKET':BUCKET,
            'SUPPORT_ALLOWED_ORIGIN':PORTAL,'STAGE':'production','SUPPORT_WEBSOCKET_API_ID':ref('Socket')}})
    r['Api']['Properties']['Name']=NAME
    add('Support','AWS::ApiGateway::Resource',RestApiId=ref('Api'),ParentId=attr('Api','RootResourceId'),PathPart='support')
    dependencies=[]
    for label,segment,methods in [('Attachments','attachments',['GET','POST','OPTIONS']),('Ticket','socket-ticket',['POST'])]:
        add(label,'AWS::ApiGateway::Resource',RestApiId=ref('Api'),ParentId=ref('Support'),PathPart=segment)
        for verb in methods:
            key=label+verb
            add(key,'AWS::ApiGateway::Method',RestApiId=ref('Api'),ResourceId=ref(label),
                HttpMethod=verb,AuthorizationType='NONE',Integration={'Type':'AWS_PROXY','IntegrationHttpMethod':'POST',
                  'Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')})
            add(key+'Invoke','AWS::Lambda::Permission',Action='lambda:InvokeFunction',FunctionName=ref('Function'),
                Principal='apigateway.amazonaws.com',SourceAccount=ref('AWS::AccountId'),
                SourceArn=sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+verb+'/support/'+segment))
            dependencies.extend((key,key+'Invoke'))
    r['Deployment']['DependsOn']=dependencies
    add('Socket','AWS::ApiGatewayV2::Api',Name=NAME,ProtocolType='WEBSOCKET',RouteSelectionExpression='$request.body.action')
    add('SocketIntegration','AWS::ApiGatewayV2::Integration',ApiId=ref('Socket'),IntegrationType='AWS_PROXY',IntegrationMethod='POST',
        IntegrationUri=sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations'))
    routes=[]
    for logical,action in [('Connect','$connect'),('Disconnect','$disconnect'),('Frame','$default')]:
        add(logical,'AWS::ApiGatewayV2::Route',ApiId=ref('Socket'),RouteKey=action,AuthorizationType='NONE',
            Target=sub('integrations/${SocketIntegration}'))
        add(logical+'Invoke','AWS::Lambda::Permission',Action='lambda:InvokeFunction',FunctionName=ref('Function'),
            Principal='apigateway.amazonaws.com',SourceAccount=ref('AWS::AccountId'),
            SourceArn=sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Socket}/production/'+action))
        routes.extend((logical,logical+'Invoke'))
    add('SocketStage','AWS::ApiGatewayV2::Stage',ApiId=ref('Socket'),StageName='production',AutoDeploy=True,
        DefaultRouteSettings={'DataTraceEnabled':False,'ThrottlingRateLimit':35,'ThrottlingBurstLimit':70})
    r['SocketStage']['DependsOn']=routes
    template['Outputs']['SocketUrl']={'Condition':'IsProductionAccount',
        'Value':sub('wss://${Socket}.execute-api.${AWS::Region}.amazonaws.com/production')}
    return template


if __name__=='__main__':
    out=Path(sys.argv[1]).resolve()
    out.mkdir(parents=True,exist_ok=True)
    modules=REPO/'backend/wallet-service/node_modules'
    bundle=subprocess.check_output([str(modules/'.bin/esbuild'),'backend/support-runtime/index.js',
        '--bundle','--platform=node','--target=node22','--format=cjs','--keep-names','--log-level=error','--drop:console'],
        cwd=REPO,env={**os.environ,'NODE_PATH':os.pathsep.join(map(str,[modules,REPO/'backend/node_modules',REPO/'backend/staff-service/node_modules']))})
    artifact=out/'support-chat.zip'
    with ZipFile(artifact,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),bundle,compress_type=ZIP_DEFLATED)
    (out/'support-chat.template.json').write_text(json.dumps(build(),separators=(',',':'))+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
