"""Isolated production region publisher; deployment does not enable publication."""
import json
from pathlib import Path
from prepare_region_management import REFERENCE_ENV, reference_count_policy
ROOT=Path(__file__).resolve().parent

def build():
 base=json.loads((ROOT/'storage-auth.template.json').read_text())
 t={k:v for k,v in base.items() if k not in ['Resources','Outputs']}
 t['Description']='Production region publication queue, retained audit and scoped worker. Disabled until composite readers are verified.'
 t['Parameters'].update(ArtifactKey={'Type':'String','AllowedPattern':'region-management/[a-f0-9]{64}.zip'},ArtifactVersion={'Type':'String','MinLength':1},WorkerEnabled={'Type':'String','Default':'false','AllowedValues':['false','true']})
 t['Conditions']['WorkerActive']={'Fn::And':[t['Conditions']['IsProductionAccount'],{'Fn::Equals':[{'Ref':'WorkerEnabled'},'true']}]}
 r={};t['Resources']=r
 def sub(s):return {'Fn::Sub':s}
 def arn(n):return sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-'+n)
 def add(n,kind,p,retain=False):
  r[n]={'Type':kind,'Condition':'IsProductionAccount','Properties':p}
  if retain:r[n].update(DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
 add('RegionAudit','AWS::DynamoDB::Table',{'TableName':'wizz-production-RegionAudit','BillingMode':'PAY_PER_REQUEST','AttributeDefinitions':[{'AttributeName':a,'AttributeType':'S'} for a in ['audit_id','regionId','timestamp']],'KeySchema':[{'AttributeName':'audit_id','KeyType':'HASH'}],'GlobalSecondaryIndexes':[{'IndexName':'region-index','KeySchema':[{'AttributeName':'regionId','KeyType':'HASH'},{'AttributeName':'timestamp','KeyType':'RANGE'}],'Projection':{'ProjectionType':'ALL'}}],'SSESpecification':{'SSEEnabled':True},'PointInTimeRecoverySpecification':{'PointInTimeRecoveryEnabled':True},'DeletionProtectionEnabled':True},True)
 add('DeadLetter','AWS::SQS::Queue',{'QueueName':'wizz-production-region-publication-dead-letter','SqsManagedSseEnabled':True,'MessageRetentionPeriod':1209600},True)
 add('Queue','AWS::SQS::Queue',{'QueueName':'wizz-production-region-publication','SqsManagedSseEnabled':True,'VisibilityTimeout':360,'MessageRetentionPeriod':345600,'RedrivePolicy':{'deadLetterTargetArn':{'Fn::GetAtt':['DeadLetter','Arn']},'maxReceiveCount':5}},True)
 log='/aws/lambda/wizz-production-region-worker'
 add('LogGroup','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':90},True)
 staff=arn('PlatformStaff')
 statements=[
 {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')},
 {'Effect':'Allow','Action':['sqs:ReceiveMessage','sqs:DeleteMessage','sqs:GetQueueAttributes','sqs:SendMessage'],'Resource':{'Fn::GetAtt':['Queue','Arn']}},
 {'Effect':'Allow','Action':['dynamodb:Scan','dynamodb:GetItem','dynamodb:PutItem','dynamodb:DeleteItem','dynamodb:ConditionCheckItem'],'Resource':[arn(n) for n in ['Regions','RegionsDerived','RegionNeighbors']]},
 {'Effect':'Allow','Action':['dynamodb:BatchWriteItem','dynamodb:DeleteItem'],'Resource':arn('RegionIndex')},
 {'Effect':'Allow','Action':['dynamodb:Query'],'Resource':sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-RegionIndex/index/region-id-index')},
 {'Effect':'Allow','Action':['dynamodb:PutItem'],'Resource':{'Fn::GetAtt':['RegionAudit','Arn']}},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':staff,'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['EMPLOYEE#*']}}},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:Query','dynamodb:PutItem','dynamodb:DeleteItem','dynamodb:ConditionCheckItem'],'Resource':staff,'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['REGION_JOB#*','REGIONS_PLAN#*','REGIONS_HISTORY#*','REGIONS_PUBLICATION#312']}}},
 {'Effect':'Allow','Action':['dynamodb:PutItem'],'Resource':staff,'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['AUDIT']}}}]
 statements.extend([
  reference_count_policy(arn),
  {'Sid':'DeleteRetiredRegionListings','Effect':'Allow','Action':['dynamodb:Query','dynamodb:DeleteItem'],'Resource':arn('RegionListings')},
 ])
 add('Role','AWS::IAM::Role',{'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},'Policies':[{'PolicyName':'ProductionRegionPublicationOnly','PolicyDocument':{'Version':'2012-10-17','Statement':statements}}]})
 add('Worker','AWS::Lambda::Function',{'FunctionName':'wizz-production-region-worker','Runtime':'nodejs22.x','Handler':'region-management/worker-entry.handler','MemorySize':512,'Timeout':55,'Role':{'Fn::GetAtt':['Role','Arn']},'Code':{'S3Bucket':'wizz-production-artifacts-746727375268-us-east-1','S3Key':{'Ref':'ArtifactKey'},'S3ObjectVersion':{'Ref':'ArtifactVersion'}},'Environment':{'Variables':{'PLATFORM_ENVIRONMENT':'production','STAFF_TABLE':'wizz-production-PlatformStaff','REGION_MANAGEMENT_ENABLED':{'Ref':'WorkerEnabled'},'REGION_COMPOSITE_READERS_READY':{'Ref':'WorkerEnabled'},'REGION_PUBLICATION_QUEUE_URL':{'Ref':'Queue'},'REGION_PUBLICATION_QUEUE_ARN':{'Fn::GetAtt':['Queue','Arn']},'REGION_RECOVERY_RULE_ARN':sub('arn:${AWS::Partition}:events:${AWS::Region}:${AWS::AccountId}:rule/wizz-production-region-recovery')}},'LoggingConfig':{'LogGroup':{'Ref':'LogGroup'}}})
 r['Worker']['Properties']['Environment']['Variables'].update({**REFERENCE_ENV, 'REGION_LISTINGS_TABLE':'wizz-production-RegionListings'})
 add('QueueConsumer','AWS::Lambda::EventSourceMapping',{'FunctionName':{'Ref':'Worker'},'EventSourceArn':{'Fn::GetAtt':['Queue','Arn']},'Enabled':{'Fn::If':['WorkerActive',True,False]},'BatchSize':1,'FunctionResponseTypes':['ReportBatchItemFailures']})
 add('Recovery','AWS::Events::Rule',{'Name':'wizz-production-region-recovery','ScheduleExpression':'rate(2 minutes)','State':{'Fn::If':['WorkerActive','ENABLED','DISABLED']},'Targets':[{'Id':'RegionRecovery','Arn':{'Fn::GetAtt':['Worker','Arn']},'RetryPolicy':{'MaximumRetryAttempts':2,'MaximumEventAgeInSeconds':300}}]})
 add('RecoveryInvoke','AWS::Lambda::Permission',{'Action':'lambda:InvokeFunction','FunctionName':{'Ref':'Worker'},'Principal':'events.amazonaws.com','SourceAccount':{'Ref':'AWS::AccountId'},'SourceArn':{'Fn::GetAtt':['Recovery','Arn']}})
 t['Outputs']={n:{'Value':{'Ref':n}} for n in ['Queue','RegionAudit','Worker']}
 return t
if __name__=='__main__':(ROOT/'region-publication.template.json').write_text(json.dumps(build(),indent=2)+'\n')
