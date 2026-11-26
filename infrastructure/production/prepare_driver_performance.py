"""Build the production driver performance projection and its evidence sources."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from prepare_customer_storefront import BUCKET, REPO, allow, attr, ref, sub, table

NAME = 'wizz-production-driver-performance'
SOURCES = {'Orders': 'Orders', 'Offers': 'WaveOffers', 'Holds': 'Holds', 'Drivers': 'Drivers'}


def build():
    params = {
        'ArtifactKey': {'Type': 'String', 'AllowedPattern': 'driver-performance/[a-f0-9]{64}[.]zip'},
        'ArtifactVersion': {'Type': 'String', 'MinLength': 1},
        'OrderForwardReady': {'Type': 'String', 'Default': 'false', 'AllowedValues': ['true', 'false']},
    }
    for key, suffix in SOURCES.items():
        params[key+'StreamArn'] = {'Type': 'String', 'AllowedPattern':
            'arn:aws:dynamodb:us-east-1:746727375268:table/wizz-production-'+suffix+'/stream/[A-Za-z0-9_.:-]+'}
    resources = {}
    condition = 'IsProduction'

    def add(key, kind, properties, **extra):
        resources[key] = {'Type': kind, 'Condition': condition, 'Properties': properties, **extra}

    def add_table(key, name, types, keys, index, **extra):
        add(key, 'AWS::DynamoDB::Table', {
            'TableName': name, 'BillingMode': 'PAY_PER_REQUEST',
            'AttributeDefinitions': [{'AttributeName': k, 'AttributeType': v} for k,v in types.items()],
            'KeySchema': keys, 'GlobalSecondaryIndexes': [index],
            'SSESpecification': {'SSEEnabled': True}, 'DeletionProtectionEnabled': True,
            'PointInTimeRecoverySpecification': {'PointInTimeRecoveryEnabled': True}, **extra,
        }, DeletionPolicy='Retain', UpdateReplacePolicy='Retain')

    def keys(partition, sort=None):
        return [{'AttributeName': partition, 'KeyType': 'HASH'}]+(
            [{'AttributeName': sort, 'KeyType': 'RANGE'}] if sort else [])

    add_table('Snapshots','wizz-production-DriverPerformanceSnapshots',
        {'pk':'S','sk':'S','queuePartition':'S','nextAttemptAt':'N'},keys('pk','sk'),
        {'IndexName':'ByDue','KeySchema':keys('queuePartition','nextAttemptAt'),
         'Projection':{'ProjectionType':'INCLUDE','NonKeyAttributes':['driverId']}},
        TimeToLiveSpecification={'AttributeName':'expiresAt','Enabled':True})
    add_table('Ratings','wizz-production-OrderRatings',
        {'pk':'S','driverRatingKey':'S','driverRatingSort':'S'},keys('pk'),
        {'IndexName':'DriverRatingChronology281','KeySchema':keys('driverRatingKey','driverRatingSort'),
         'Projection':{'ProjectionType':'ALL'}},
        StreamSpecification={'StreamViewType':'NEW_AND_OLD_IMAGES'})

    add('Failures','AWS::SQS::Queue',{'QueueName':NAME+'-failures',
        'SqsManagedSseEnabled':True,'MessageRetentionPeriod':1209600},DeletionPolicy='Retain')
    add('RefreshQueue','AWS::SQS::Queue',{'QueueName':NAME+'-refresh','SqsManagedSseEnabled':True,
        'VisibilityTimeout':900,'RedrivePolicy':{'deadLetterTargetArn':attr('Failures','Arn'),'maxReceiveCount':5}})

    def source_arn(key):
        return attr('Ratings','StreamArn') if key=='Ratings' else ref(key+'StreamArn')

    streams = {f'wizz-production-{name}':'${'+key+'Stream}' for key,name in SOURCES.items()}
    streams['wizz-production-OrderRatings'] = '${RatingsStream}'
    env = {
        'STAGE':'production','ORDER_FORWARD_READY':ref('OrderForwardReady'),
        'SOURCE_STREAMS':{'Fn::Sub':[json.dumps(streams,separators=(',',':')),
            {key+'Stream':source_arn(key) for key in [*SOURCES,'Ratings']}]},
        'DRIVER_PERFORMANCE_TABLE':ref('Snapshots'),'WORK_QUEUE_URL':ref('RefreshQueue'),
        'FAILURE_QUEUE_URL':ref('Failures'),
    }
    artifact = {'S3Bucket':BUCKET, 'S3Key':ref('ArtifactKey'), 'S3ObjectVersion':ref('ArtifactVersion')}
    read_sources = allow('dynamodb:GetItem',[table(name) for name in SOURCES.values()]+[attr('Ratings','Arn')])
    snapshot_reads = allow(['dynamodb:GetItem','dynamodb:Query'],
        [attr('Snapshots','Arn'),sub('${Snapshots.Arn}/index/ByDue')])
    snapshot_writes = allow(['dynamodb:PutItem','dynamodb:UpdateItem'],attr('Snapshots','Arn'))
    stream_reads = allow(['dynamodb:GetRecords','dynamodb:GetShardIterator','dynamodb:DescribeStream','dynamodb:ListStreams'],
        [source_arn(key) for key in ('Offers','Holds','Drivers','Ratings')])
    for logical, suffix, seconds, permissions in [
        ('Collector','collector',60,[
            read_sources,allow('dynamodb:Query',table('WaveOffers')),snapshot_reads,snapshot_writes,stream_reads,
            allow('sqs:SendMessage',[attr('RefreshQueue','Arn'),attr('Failures','Arn')]),
        ]),
        ('Worker','projection',120,[
            read_sources,allow('dynamodb:Query',[
                table('Holds'),table('WaveOffers/index/driverId-sentAt-index'),
                sub('${Ratings.Arn}/index/DriverRatingChronology281')]),
            snapshot_reads,snapshot_writes,allow('dynamodb:DeleteItem',attr('Snapshots','Arn')),
            allow(['lambda:ListEventSourceMappings','cloudwatch:GetMetricData'],'*'),
            allow(['sqs:GetQueueAttributes','sqs:ReceiveMessage','sqs:DeleteMessage'],attr('RefreshQueue','Arn')),
            allow('sqs:GetQueueAttributes',attr('Failures','Arn')),allow('sqs:SendMessage',attr('RefreshQueue','Arn')),
        ]),
    ]:
        name=NAME+'-'+suffix
        log='/aws/lambda/'+name
        add(logical+'Log','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':90},DeletionPolicy='Retain')
        log_access=allow(['logs:CreateLogStream','logs:PutLogEvents'],
            sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*'))
        add(logical+'Role','AWS::IAM::Role',{'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[
            {'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},
            'Policies':[{'PolicyName':'DriverPerformance','PolicyDocument':{'Version':'2012-10-17',
                'Statement':[log_access,*permissions]}}]})
        add(logical,'AWS::Lambda::Function',{'FunctionName':name,'Role':attr(logical+'Role','Arn'),
            'Code':artifact,'Environment':{'Variables':env},'Handler':'index.handler','Runtime':'nodejs22.x',
            'MemorySize':512 if logical=='Worker' else 256,'Timeout':seconds,
            'LoggingConfig':{'LogGroup':ref(logical+'Log')}})
    add('CollectorRetry','AWS::Lambda::EventInvokeConfig',{'FunctionName':ref('Collector'),'Qualifier':'$LATEST',
        'MaximumRetryAttempts':2,'MaximumEventAgeInSeconds':3600,
        'DestinationConfig':{'OnFailure':{'Destination':attr('Failures','Arn')}}})
    for key in ('Offers','Holds','Drivers','Ratings'):
        add(key+'Events','AWS::Lambda::EventSourceMapping',{
            'EventSourceArn':source_arn(key),'StartingPosition':'TRIM_HORIZON','FunctionName':ref('Collector'),
            'BatchSize':10,'BisectBatchOnFunctionError':True,'MaximumRetryAttempts':10,
            'FunctionResponseTypes':['ReportBatchItemFailures'],'Enabled':True,
            'DestinationConfig':{'OnFailure':{'Destination':attr('Failures','Arn')}},
        })
    add('WorkEvents','AWS::Lambda::EventSourceMapping',{
        'EventSourceArn':attr('RefreshQueue','Arn'),'FunctionName':ref('Worker'),'Enabled':True,'BatchSize':4,
        'MaximumBatchingWindowInSeconds':1,'FunctionResponseTypes':['ReportBatchItemFailures'],
    })
    add('Reconcile','AWS::Events::Rule',{'Name':NAME+'-reconcile','ScheduleExpression':'rate(1 minute)',
        'State':'ENABLED','Targets':[{'Id':'ProjectionHealth','Arn':attr('Worker','Arn'),'Input':'{"kind":"SCHEDULE"}'}]})
    add('ReconcileInvoke','AWS::Lambda::Permission',{'FunctionName':ref('Worker'),'Principal':'events.amazonaws.com',
        'Action':'lambda:InvokeFunction','SourceArn':attr('Reconcile','Arn'),'SourceAccount':ref('AWS::AccountId')})
    return {
        'AWSTemplateFormatVersion':'2010-09-09',
        'Description':'Isolated production driver performance projection from verified order, offer, hold, driver and rating evidence.',
        'Conditions':{condition:{'Fn::And':[{'Fn::Equals':[ref('AWS::AccountId'),'746727375268']},
            {'Fn::Equals':[ref('AWS::Region'),'us-east-1']}] }},
        'Parameters':params,'Resources':resources,
        'Outputs':{'CollectorArn':{'Condition':condition,'Value':attr('Collector','Arn')}},
    }


if __name__ == '__main__':
    out=Path(sys.argv[1])
    out.mkdir(parents=True,exist_ok=True)
    bundle=subprocess.check_output([
        str(REPO/'backend/wallet-service/node_modules/.bin/esbuild'),'backend/driver-performance-projection/index.js',
        '--bundle','--platform=node','--target=node22','--format=cjs','--log-level=error','--external:@aws-sdk/*',
    ],cwd=REPO)
    artifact=out/'driver-performance.zip'
    with ZipFile(artifact,'w') as archive:
        archive.writestr(ZipInfo('index.js',(2026,1,1,0,0,0)),bundle,compress_type=ZIP_DEFLATED)
    (out/'driver-performance.template.json').write_text(json.dumps(build(),indent=2)+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())
