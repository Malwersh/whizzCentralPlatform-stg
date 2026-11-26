"""Build the authenticated production offer and active order API."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import REPO, ROOT, allow, ref, sub
from prepare_driver_search import build as search_template, ROUTES as SEARCH_ROUTES
from prepare_order_financial_runtime import build as financial_template, dynamodb

NAME = 'wizz-production-driver-offers'
ROUTES = {
    'ReadOffer': ('financial-wave-offer', 'POST', 'DriversPath', 'financial-wave-offer'),
    'Accept': ('accept-wave-offer', 'POST', 'DriversPath', 'accept-wave-offer'),
    'Decline': ('reject-wave-offer', 'POST', 'DriversPath', 'reject-wave-offer'),
    'ActiveOrder': ('active-order', 'GET', 'DriversPath', 'active-order'),
    'AssignedOrder': ('{orderId}', 'GET', 'Orders', 'orders/*'),
    'TripAction': ('{tripAction}', 'POST', 'AssignedOrder', 'orders/*/*'),
    'DisplayedOffer': ('displayed','POST','OffersPath','offers/displayed'),
}


def build():
    template = search_template()
    template['Description'] = 'Production financial driver offer hydration and response with active assignment reads.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'driver-offers/[a-f0-9]{64}[.]zip'
    resources = template['Resources']
    for route in SEARCH_ROUTES:
        for suffix in ('','Invoke','Method'):
            del resources[route+suffix]

    log = '/aws/lambda/' + NAME
    resources['LogGroup']['Properties']['LogGroupName'] = log
    policy = resources['Role']['Properties']['Policies'][0]
    policy['PolicyName'] = 'ProductionDriverOffers'
    bindings = json.loads((ROOT/'wallet-identity-bindings.json').read_text())['identities']
    wallets = ('WALLET#DRIVER#*','WALLET#MERCHANT#*')
    eligibility = ('OPERATIONAL_SETTINGS#DELIVERY_PRICING','OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS')
    budget = ('DELIVERY_BUDGET#*','DELIVERY_RESERVATION#*','DELIVERY_USAGE#*')
    permissions = {
        'Orders': (('ORDER#*',), ('GetItem','ConditionCheckItem','UpdateItem')),
        'DispatchJobs': ((), ('GetItem','ConditionCheckItem','UpdateItem','PutItem')),
        'WaveOffers': ((), ('GetItem','ConditionCheckItem','UpdateItem')),
        'DriverLiveState': ((), ('GetItem','ConditionCheckItem','UpdateItem')),
        'Drivers': ((), ('GetItem','ConditionCheckItem')),
        'Merchants': ((), ('GetItem','ConditionCheckItem')),
        'AccountDeletion': (('ACCOUNT_LIFECYCLE#DRIVER#*','ACCOUNT_LIFECYCLE#MERCHANT#*','BUSINESS_LIFECYCLE#MERCHANT#*'),
                            ('GetItem','ConditionCheckItem')),
        'PlatformStaff': (eligibility+budget, ('GetItem','ConditionCheckItem')),
        'Holds': ((), ('GetItem','ConditionCheckItem','PutItem','UpdateItem')),
        'Wallets': (wallets, ('GetItem','ConditionCheckItem','UpdateItem')),
        'LedgerEntries': (wallets, ('PutItem',)),
        'MerchantPlatform': (('MERCHANT_ACCRUAL#*','FULL_CASH_JOURNAL#*'), ('GetItem','PutItem')),
        'OfferJourney': (('BENEFIT_ORDER#*','USER#*'), ('GetItem','PutItem')),
        'AuditLog': (('date#*',), ('PutItem',)),
        'Regions': ((), ('GetItem','ConditionCheckItem')),
        'RegionsDerived': ((), ('GetItem','ConditionCheckItem')),
        'RegionNeighbors': ((), ('GetItem','ConditionCheckItem')),
    }
    statements = []
    for table, (keys, actions) in permissions.items():
        reads = tuple(action for action in actions if action in ('GetItem', 'ConditionCheckItem'))
        writes = tuple(action for action in actions if action not in reads)
        for group in (reads, writes):
            if group:
                item = dynamodb(table, group[0], keys)
                item['Action'] = ['dynamodb:' + action for action in group]
                statements.append(item)
    policy['PolicyDocument']['Statement'] = [
        allow(['logs:CreateLogStream','logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')),
        allow('cognito-idp:AdminGetUser',
              sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/'+bindings['driver']['poolId'])),
        *statements,
        dynamodb('WaveOffers','Query'),
        dynamodb('WaveOffers','PutItem'),
        dynamodb('Wallets','PutItem',('WALLET#MERCHANT#*',)),
        dynamodb('PlatformStaff','PutItem',budget),
        dynamodb('WalletLifecycle','GetItem',('FCH:*',)),
        dynamodb('WalletLifecycle','UpdateItem',('FCH:*',)),
        dynamodb('WalletLifecycle','PutItem',('CDA:*:EVENT','FCS:*:EVENT','FCH:*','FH:*')),
    ]
    base = financial_template()['Resources']['Function']['Properties']['Environment']['Variables']
    env = {k:v for k,v in base.items() if isinstance(v,str)}
    config = '{"accountId":"746727375268","region":"us-east-1","schemaVersion":1,"scopes":[]}'
    env.update(ENVIRONMENT='production',STAGE='production',FINANCIAL_COD_ACCOUNT_ID='746727375268',
        FINANCE_GENERAL_RELEASE_MODE='REQUIRED', FINANCE_ROLLOUT_CONFIG=config,
        FINANCE_ROLLOUT_SHA256=hashlib.sha256(config.encode()).hexdigest(),
        DRIVER_VEHICLE_REGISTRY_ENFORCE='true', DRIVER_WORK_REGION_ENFORCE='true')
    resources['Function']['Properties'].update(FunctionName=NAME,MemorySize=512,Timeout=25,Environment={'Variables':env})
    resources['Api']['Properties']['Name'] = NAME

    def add(logical,kind,properties):
        resources[logical] = {'Type':kind,'Condition':'IsProductionAccount','Properties':properties}

    add('Orders','AWS::ApiGateway::Resource',{'RestApiId':ref('Api'),'ParentId':ref('DriversPath'),'PathPart':'orders'})
    add('OffersPath','AWS::ApiGateway::Resource',{'RestApiId':ref('Api'),'ParentId':ref('DriversPath'),'PathPart':'offers'})
    dependencies = []
    for logical,(route,method,parent,source_path) in ROUTES.items():
        add(logical,'AWS::ApiGateway::Resource',
            {'RestApiId':ref('Api'),'ParentId':ref(parent),'PathPart':route})
        add(logical+'Method','AWS::ApiGateway::Method',{
            'RestApiId':ref('Api'),'ResourceId':ref(logical),'HttpMethod':method,'AuthorizationType':'NONE',
            'Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST',
                'Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')},
        })
        add(logical+'Invoke','AWS::Lambda::Permission',{
            'Action':'lambda:InvokeFunction','FunctionName':ref('Function'),'Principal':'apigateway.amazonaws.com',
            'SourceAccount':ref('AWS::AccountId'),'SourceArn':sub(
                'arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+method+'/driver/'+source_path),
        })
        dependencies += [logical+'Method',logical+'Invoke']
    deployment = resources.pop('Deployment')
    deployment['DependsOn'] = dependencies
    resources['DisplayReceiptDeployment'] = deployment
    resources['Stage']['Properties']['DeploymentId'] = ref('DisplayReceiptDeployment')
    return template


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True,exist_ok=True)
    bundle = subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),
        'backend/wallet-service/src/productionDriverOffers.ts','--bundle','--platform=node',
        '--target=node22','--format=cjs','--log-level=error','--external:@aws-sdk/*',
    ],cwd=REPO)
    artifact = out/'driver-offers.zip'
    with ZipFile(artifact,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),bundle,compress_type=ZIP_DEFLATED)
    (out/'driver-offers.template.json').write_text(json.dumps(build(),indent=2)+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
