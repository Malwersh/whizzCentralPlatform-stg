"""Package the production driver search API and its restricted gateway routes."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import BUCKET, REPO, ROOT, allow, attr, ref, sub, table
from prepare_merchant_profile import build as profile_template

NAME = 'wizz-production-driver-search'
ROUTES = {
    'Eligibility': ('search-eligibility', 'GET'),
    'Start': ('start-searching', 'POST'),
    'Stop': ('stop-searching', 'POST'),
    'Location': ('update-location', 'POST'),
}


def build(include_performance=False, include_availability=False, include_history=False, include_activity=False):
    template = profile_template()
    template['Description'] = 'Production driver search, position and region eligibility.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'driver-search/[a-f0-9]{64}[.]zip'
    resources = template['Resources']
    for key in ('Auth', 'Profile', 'Authorizer', 'GETMethod', 'POSTMethod', 'GETInvoke', 'POSTInvoke'):
        del resources[key]
    log = '/aws/lambda/' + NAME
    resources['LogGroup']['Properties']['LogGroupName'] = log
    policy = resources['Role']['Properties']['Policies'][0]
    policy['PolicyName'] = 'ProductionDriverSearch'
    bindings = json.loads((ROOT/'wallet-identity-bindings.json').read_text())['identities']
    purpose = {'StringEquals': {'dynamodb:EnclosingOperation': 'TransactWriteItems'}}
    policy['PolicyDocument']['Statement'] = [
        allow(['logs:CreateLogStream','logs:PutLogEvents'],
              sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*')),
        allow('cognito-idp:AdminGetUser',
              sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + bindings['driver']['poolId'])),
        allow(['dynamodb:GetItem','dynamodb:ConditionCheckItem'], [table(n) for n in
              ('Drivers','Regions','RegionsDerived','RegionNeighbors')]),
        allow(['dynamodb:GetItem','dynamodb:ConditionCheckItem'], table('AccountDeletion'),
              {'ForAllValues:StringLike': {'dynamodb:LeadingKeys':['ACCOUNT_LIFECYCLE#DRIVER#*']}}),
        allow('dynamodb:Query', table('RegionIndex/index/h3-index')),
        allow('dynamodb:GetItem', table('DriverLiveState')),
        allow('dynamodb:UpdateItem', table('DriverLiveState'), purpose),
    ]
    env = {'ENVIRONMENT':'production','DRIVER_VEHICLE_REGISTRY_ENFORCE':'true'}
    for role, entry in bindings.items():
        env[role.upper()+'_USER_POOL_ID'] = entry['poolId']
        env[role.upper()+'_CLIENT_ID'] = entry['clientId']
    resources['Function']['Properties'].update(FunctionName=NAME,MemorySize=512,Timeout=12,
        Environment={'Variables':env},Code={'S3Bucket':BUCKET,'S3Key':ref('ArtifactKey'),'S3ObjectVersion':ref('ArtifactVersion')})
    resources['Api']['Properties']['Name'] = NAME
    resources['Stage']['Properties']['MethodSettings'][0].update(ThrottlingBurstLimit=80,ThrottlingRateLimit=40)

    def add(key,kind,properties):
        resources[key] = {'Type':kind,'Condition':'IsProductionAccount','Properties':properties}

    add('DriversPath','AWS::ApiGateway::Resource',
        {'RestApiId':ref('Api'),'ParentId':attr('Api','RootResourceId'),'PathPart':'driver'})
    dependencies = []
    routes = dict(ROUTES)
    if include_performance:
        routes['Performance'] = ('performance','GET')
        policy['PolicyDocument']['Statement'].append(allow('dynamodb:GetItem', table('DriverPerformanceSnapshots')))
    if include_availability:
        routes.update(MapData=('map-data','GET'), DemandForecast=('demand-forecast','GET'))
        policy['PolicyDocument']['Statement'].extend([
            allow('dynamodb:Scan',table('Merchants')),
            allow('dynamodb:Query',table('RegionNeighbors/index/source-region-index')),
            allow('dynamodb:GetItem',table('WorkingHours')),
            allow('dynamodb:GetItem',table('PlatformStaff'),{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['OPERATIONAL_SETTINGS#DRIVER_MAP_TOOLS']},'Null':{'dynamodb:LeadingKeys':'false'}}),
            allow('dynamodb:GetItem',attr('DemandTable','Arn')),
        ])
    if include_history:
        routes.update(TripHistory=('trips','GET'), TripHistoryDetail=('{orderId}','GET'))
        env['FINANCIAL_SETTLEMENT_MODEL']='FULL_CASH_AT_DELIVERY_V1'
        policy['PolicyDocument']['Statement'].extend([
            allow('dynamodb:Scan',table('Orders')),
            allow('dynamodb:GetItem',table('Orders'),{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ORDER#*']}}),
            allow('dynamodb:GetItem',table('Holds')),
        ])
    if include_activity:
        routes['MapActivity'] = ('map-activity', 'POST')
        policy['PolicyDocument']['Statement'].extend([
            allow('dynamodb:GetItem',table('Merchants')),
            allow('dynamodb:Query',table('Orders/index/GSI_StoreStatus')),
        ])
    for logical,(route,method) in routes.items():
        add(logical,'AWS::ApiGateway::Resource',
            {'RestApiId':ref('Api'),'ParentId':ref('TripHistory' if logical=='TripHistoryDetail' else 'DriversPath'),'PathPart':route})
        api_method = logical+'Method'
        invoke = logical+'Invoke'
        add(api_method,'AWS::ApiGateway::Method',{
            'RestApiId':ref('Api'),'ResourceId':ref(logical),'HttpMethod':method,
            # The Lambda validates the exact production access token with Cognito before data reads.
            'AuthorizationType':'NONE',
            'Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST',
                'Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')},
        })
        add(invoke,'AWS::Lambda::Permission',{
            'Action':'lambda:InvokeFunction','FunctionName':ref('Function'),'Principal':'apigateway.amazonaws.com',
            'SourceAccount':ref('AWS::AccountId'),'SourceArn':sub(
                'arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+method+'/driver/'+('trips/*' if logical=='TripHistoryDetail' else route)),
        })
        dependencies += [api_method,invoke]
    resources['Deployment']['DependsOn'] = dependencies
    if include_performance:
        resources['PerformanceDeployment'] = resources.pop('Deployment')
        resources['Stage']['Properties']['DeploymentId'] = ref('PerformanceDeployment')
    if include_availability:
        previous = 'PerformanceDeployment' if include_performance else 'Deployment'
        resources[previous]['DependsOn'] = [key for key in dependencies if not key.startswith(('MapData','DemandForecast','TripHistory','MapActivity'))]
        add('HomeDataDeployment','AWS::ApiGateway::Deployment',{'RestApiId':ref('Api')})
        resources['HomeDataDeployment']['DependsOn'] = [key for key in dependencies if not key.startswith(('TripHistory','MapActivity'))]
        resources['Stage']['Properties']['DeploymentId'] = ref('HomeDataDeployment')
        add_demand_worker(template,add)
    if include_history:
        add('HistoryDeployment','AWS::ApiGateway::Deployment',{'RestApiId':ref('Api')})
        resources['HistoryDeployment']['DependsOn'] = [key for key in dependencies if not key.startswith('MapActivity')]
        resources['Stage']['Properties']['DeploymentId'] = ref('HistoryDeployment')
        resources['DemandSchedule']['Properties']['ScheduleExpression'] = 'cron(0 * * * ? *)'
    if include_activity:
        add('MapActivityDeployment','AWS::ApiGateway::Deployment',{'RestApiId':ref('Api')})
        resources['MapActivityDeployment']['DependsOn'] = dependencies
        resources['Stage']['Properties']['DeploymentId'] = ref('MapActivityDeployment')
    template['Outputs']['ApiUrl']['Condition'] = 'IsProductionAccount'
    return template


def add_demand_worker(template,add):
    worker = 'wizz-production-driver-demand'
    log = '/aws/lambda/' + worker
    template['Parameters'].update(
        DemandArtifactKey={'Type':'String','AllowedPattern':'driver-demand/[a-f0-9]{64}[.]zip'},
        DemandArtifactVersion={'Type':'String','MinLength':1},
        DemandCoverageStart={'Type':'String','AllowedPattern':r'[0-9TZ:.+\-]+'},
        DispatchStreamArn={'Type':'String','AllowedPattern':r'arn:aws:dynamodb:us-east-1:746727375268:table/wizz-production-DispatchJobs/stream/[0-9T:.\-]+'},
    )
    add('DemandTable','AWS::DynamoDB::Table',{
        'TableName':'wizz-production-DriverDemand','BillingMode':'PAY_PER_REQUEST',
        'AttributeDefinitions':[{'AttributeName':name,'AttributeType':'S'} for name in ('pk','sk')],
        'KeySchema':[{'AttributeName':'pk','KeyType':'HASH'},{'AttributeName':'sk','KeyType':'RANGE'}],
        'SSESpecification':{'SSEEnabled':True},
        'TimeToLiveSpecification':{'AttributeName':'expiresAt','Enabled':True},
    })
    template['Resources']['DemandTable'].update(DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
    add('DemandLog','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':30})
    add('DemandFailures','AWS::SQS::Queue',{'QueueName':'wizz-production-driver-demand-failures',
        'SqsManagedSseEnabled':True,'MessageRetentionPeriod':1209600})
    source = {'DISPATCH_JOBS_TABLE':'DispatchJobs','ORDERS_TABLE':'Orders',
        'BUSINESSES_TABLE':'Merchants','WORKING_HOURS_TABLE':'WorkingHours','REGIONS_TABLE':'RegionsDerived'}
    statements = [
        allow(['logs:CreateLogStream','logs:PutLogEvents'],
            sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')),
        allow('dynamodb:GetItem',[table(name) for name in source.values()]),
        allow('dynamodb:Scan',[table(name) for env,name in source.items() if env!='ORDERS_TABLE']),
        allow(['dynamodb:Scan','dynamodb:GetItem','dynamodb:PutItem'],attr('DemandTable','Arn')),
        allow(['dynamodb:DescribeStream','dynamodb:GetRecords','dynamodb:GetShardIterator'],ref('DispatchStreamArn')),
        allow('dynamodb:ListStreams',table('DispatchJobs/stream/*')),
        allow('sqs:SendMessage',attr('DemandFailures','Arn')),
    ]
    add('DemandRole','AWS::IAM::Role',{
        'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{
            'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole',
        }]},
        'Policies':[{'PolicyName':'ProductionDemandAnalytics',
            'PolicyDocument':{'Version':'2012-10-17','Statement':statements}}],
    })
    add('DemandWorker','AWS::Lambda::Function',{
        'FunctionName':worker,'Handler':'worker.handler','Runtime':'python3.12',
        'MemorySize':256,'Timeout':300,'Role':attr('DemandRole','Arn'),
        'Code':{'S3Bucket':BUCKET,'S3Key':ref('DemandArtifactKey'),'S3ObjectVersion':ref('DemandArtifactVersion')},
        'Environment':{'Variables':{**{key:'wizz-production-'+name for key,name in source.items()},
            'DEMAND_TABLE':ref('DemandTable'),'DEMAND_DATASET':'LIVE','COVERAGE_START':ref('DemandCoverageStart')}},
        'LoggingConfig':{'LogGroup':ref('DemandLog')},
    })
    add('DemandSchedule','AWS::Events::Rule',{
        'Name':worker,'ScheduleExpression':'rate(1 hour)','State':'ENABLED',
        'Targets':[{'Id':'RebuildDemandForecast','Arn':attr('DemandWorker','Arn'),'Input':'{}',
            'RetryPolicy':{'MaximumRetryAttempts':2,'MaximumEventAgeInSeconds':3600}}],
    })
    add('DemandScheduleInvoke','AWS::Lambda::Permission',{
        'Principal':'events.amazonaws.com','Action':'lambda:InvokeFunction',
        'FunctionName':ref('DemandWorker'),'SourceArn':attr('DemandSchedule','Arn'),
    })
    add('DemandStream','AWS::Lambda::EventSourceMapping',{
        'EventSourceArn':ref('DispatchStreamArn'),'FunctionName':ref('DemandWorker'),
        'StartingPosition':'LATEST','Enabled':True,'BatchSize':100,'MaximumBatchingWindowInSeconds':10,
        'MaximumRetryAttempts':6,'MaximumRecordAgeInSeconds':21600,'BisectBatchOnFunctionError':True,
        'FunctionResponseTypes':['ReportBatchItemFailures'],
        'DestinationConfig':{'OnFailure':{'Destination':attr('DemandFailures','Arn')}},
        'FilterCriteria':{'Filters':[{'Pattern':json.dumps({
            'eventName':['INSERT','MODIFY'],'dynamodb':{'NewImage':{'SK':{'S':['METADATA']}}},
        })}]},
    })


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.mkdir(parents=True,exist_ok=True)
    bundle = subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),
        'backend/wallet-service/src/productionDriverSearch.ts','--bundle','--platform=node',
        '--target=node22','--format=cjs','--log-level=error','--external:@aws-sdk/*',
    ], cwd=REPO)
    artifact = out/'driver-search.zip'
    with ZipFile(artifact,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),bundle,compress_type=ZIP_DEFLATED)
    demand_source = REPO.parent/'whizzDrivers-stg'/'backend'/'demand'/'worker.py'
    with ZipFile(out/'driver-demand.zip','w') as archive:
        archive.writestr(ZipInfo('worker.py',(2026,1,1,0,0,0)),demand_source.read_bytes(),compress_type=ZIP_DEFLATED)
    (out/'driver-search.template.json').write_text(
        json.dumps(build(include_performance=True,include_availability=True,include_history=True,include_activity=True),indent=2)+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
