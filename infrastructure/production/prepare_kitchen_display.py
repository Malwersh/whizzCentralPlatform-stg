"""Package staging kitchen sources with isolated production deployment bindings."""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
MERCHANT = REPO.parent / 'whizzMerchants-stg'


def template():
    source = (MERCHANT / 'backend/kitchen-display/template.yaml').read_text()
    source = source.replace('isolated staging stack', 'isolated production stack')
    source = source.replace('staging-MerchantPlatform', 'wizz-production-MerchantPlatform')
    source = source.replace('staging-AccountDeletion', 'wizz-production-AccountDeletion')
    source = source.replace('WhizzMerchants_Businesses', 'wizz-production-Merchants').replace('WizzOrders', 'wizz-production-Orders')
    source = source.replace('staging', 'production')
    source = source.replace('  MerchantOrderFunctionArn:\n    Type: String\n', """  ArtifactKey:
    Type: String
    AllowedPattern: kitchen-display/[a-f0-9]{64}[.]zip
  ArtifactVersion:
    Type: String
    MinLength: 1
  StreamEnabled:
    Type: String
    Default: 'false'
    AllowedValues: ['true', 'false']
Rules:
  ProductionAccount:
    Assertions:
      - Assert: !Equals [!Ref 'AWS::AccountId', '746727375268']
        AssertDescription: Use the production account.
      - Assert: !Equals [!Ref 'AWS::Region', us-east-1]
        AssertDescription: Use us-east-1.
""")
    source = source.replace('    CodeUri: .build/', """    CodeUri:
      Bucket: wizz-production-artifacts-746727375268-us-east-1
      Key: !Ref ArtifactKey
      Version: !Ref ArtifactVersion""")
    source = source.replace('        STAGE: !Ref Stage', """        STAGE: !Ref Stage
        ENVIRONMENT: production
        KITCHEN_ENVIRONMENT: production""")
    source = source.replace('Handler: kitchen-display/runtime.', 'Handler: display.')
    paths = '''          /kitchen-display/advance:
            post:
              responses: {}
              x-amazon-apigateway-integration:
                type: aws_proxy
                httpMethod: POST
                uri: !Sub 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${ActionsFunction.Arn}/invocations'
            options:
              responses: {}
        # Advance preflight is handled by the same Lambda.
              x-amazon-apigateway-integration:
                type: aws_proxy
                httpMethod: POST
                uri: !Sub 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${ActionsFunction.Arn}/invocations'
          /auth/kitchen-screens:
            post:
              security: [{MerchantOwner: []}]
              responses: {}
              x-amazon-apigateway-integration:
                type: aws_proxy
                httpMethod: POST
                uri: !Sub 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${ActionsFunction.Arn}/invocations'
'''
    source = re.sub(r'          /kitchen-display/advance:.*?(?=  HttpFunction:)', paths, source, count=1, flags=re.S)
    source = source.replace('  HttpFunction:', """  ActionsFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: actions.handler
      Environment:
        Variables:
          KITCHEN_ORIGIN: !Sub 'https://${Distribution.DomainName}'
          KITCHEN_DISPLAY_URL: !Sub 'https://${Distribution.DomainName}'
          FINANCIAL_COD_ACCOUNT_ID: '746727375268'
          MERCHANT_RESPONSE_MODE: REQUIRED
      Policies:
        - Statement:
            - Effect: Allow
              Action: cognito-idp:AdminGetUser
              Resource: !Sub 'arn:aws:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_2sKZ4fGbZ'
            - Effect: Allow
              Action: [dynamodb:GetItem, dynamodb:ConditionCheckItem]
              Resource:
                - !Sub 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-Orders'
                - !Sub 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-Merchants'
                - !Sub 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-AccountDeletion'
            - Effect: Allow
              Action: dynamodb:UpdateItem
              Resource: !Sub 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-Orders'
            - Effect: Allow
              Action: dynamodb:PutItem
              Resource: !Sub 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-AuditLog'
            - Effect: Allow
              Action: [dynamodb:GetItem, dynamodb:Query, dynamodb:PutItem, dynamodb:ConditionCheckItem]
              Resource: !Sub 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-MerchantPlatform'
              Condition:
                ForAllValues:StringLike:
                  dynamodb:LeadingKeys: ['KITCHEN_PAIR#*', 'KITCHEN_RATE#*', 'BRANCH#*']
      Events:
        Advance:
          Type: Api
          Properties: {RestApiId: !Ref KitchenApi, Path: /kitchen-display/advance, Method: post}
        AdvanceOptions:
          Type: Api
          Properties: {RestApiId: !Ref KitchenApi, Path: /kitchen-display/advance, Method: options}
        Owner:
          Type: Api
          Properties:
            RestApiId: !Ref KitchenApi
            Path: /auth/kitchen-screens
            Method: post
            Auth: {Authorizer: MerchantOwner}
  HttpFunction:""")
    source = source.replace('      DefinitionBody:', """      Auth:
        Authorizers:
          MerchantOwner:
            UserPoolArn: !Sub 'arn:aws:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_2sKZ4fGbZ'
      DefinitionBody:""")
    stream_start = source.index('      Events:', source.index('  StreamFunction:'))
    policy_start = source.index('      Policies:', stream_start)
    source = source[:stream_start] + source[policy_start:]
    # A new branch gives the screen a separate origin without creating a new
    # Amplify application or modifying the current portal deployment.
    host_start = source.index('  WebBucket:')
    host_end = source.index('  KitchenApi:')
    source = source[:host_start] + '''  KitchenWebBranch:
    Type: AWS::Amplify::Branch
    Properties:
      AppId: dy2cvcjvju3cf
      BranchName: kitchen
      Stage: PRODUCTION
      EnableAutoBuild: false
''' + source[host_end:]
    source = source.replace('https://${Distribution.DomainName}', 'https://kitchen.dy2cvcjvju3cf.amplifyapp.com')
    source = source.replace('  WebBucket: {Value: !Ref WebBucket}', "  WebAppId: {Value: dy2cvcjvju3cf}\n  WebBranch: {Value: kitchen}")
    source = source.replace('      Handler: display.stream', '''      Handler: display.stream
      FunctionName: wizz-production-hosted-kitchen-projection''')
    start = source.index('  StreamFunction:')
    source = source[:start] + source[start:].replace("        Variables:\n", "        Variables:\n          KITCHEN_STREAM_ENABLED: !Ref StreamEnabled\n          KITCHEN_ORDERS_STREAM_ARN: !Ref OrdersStreamArn\n", 1)
    return source


def build(out):
    out.mkdir(parents=True, exist_ok=True)
    modules = REPO / 'backend/wallet-service/node_modules'
    paths = {
        'display.js': MERCHANT / 'backend/kitchen-display/runtime.js',
        'actions.js': ROOT / 'kitchen-display/runtime.cjs',
    }
    with ZipFile(out / 'kitchen-display.zip', 'w', ZIP_DEFLATED) as archive:
        for name, entry in paths.items():
            data = subprocess.check_output([str(modules / '.bin/esbuild'), str(entry), '--bundle',
                '--platform=node', '--target=node22', '--format=cjs', '--external:@aws-sdk/*', '--log-level=error'], cwd=REPO)
            archive.writestr(name, data)
    (out / 'template.yaml').write_text(template())
    web = out / 'web'
    web.mkdir(exist_ok=True)
    for name in ('index.html', 'kitchen.js', 'kitchen.css'):
        shutil.copyfile(MERCHANT / 'kitchen-web' / name, web / name)
    print(json.dumps({'artifact': str(out / 'kitchen-display.zip'), 'template': str(out / 'template.yaml')}))


if __name__ == '__main__':
    build(Path(sys.argv[1]).resolve())
