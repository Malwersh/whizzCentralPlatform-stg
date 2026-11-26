"""Production region administration with separately gated draft and publication routes."""
import json
from pathlib import Path
from prepare_region_management import REFERENCE_ENV, reference_count_policy
ROOT=Path(__file__).resolve().parent

def build():
 base=json.loads((ROOT/'storage-auth.template.json').read_text())
 t={k:v for k,v in base.items() if k not in ('Resources','Outputs')}
 t['Description']='Authenticated production region administration reads. No region writes or publication permissions.'
 t['Parameters'].update(ArtifactKey={'Type':'String','AllowedPattern':'region-management/[a-f0-9]{64}.zip'},ArtifactVersion={'Type':'String','MinLength':1},WritesEnabled={'Type':'String','Default':'false','AllowedValues':['false','true']},ReadersReady={'Type':'String','Default':'false','AllowedValues':['false','true']})
 t['Conditions']['RegionWritesActive']={'Fn::Equals':[{'Ref':'WritesEnabled'},'true']}
 def sub(s):return {'Fn::Sub':s}
 def arn(n):return sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-'+n)
 r={};t['Resources']=r
 def add(n,kind,p):r[n]={'Type':kind,'Condition':'IsProductionAccount','Properties':p}
 log='/aws/lambda/wizz-production-region-api'
 statements=[
 {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')},
 {'Effect':'Allow','Action':['dynamodb:Scan'],'Resource':[arn(n) for n in ('Regions','RegionsDerived')]},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:Query'],'Resource':arn('PlatformStaff'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['EMPLOYEE#*','REGIONS_PLAN#*','REGION_JOB#*','REGIONS_HISTORY#*','REGIONS_PUBLICATION#312']}}},
 {'Effect':'Allow','Action':['dynamodb:Query'],'Resource':sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-RegionAudit/index/region-index')},
 {'Effect':'Allow','Action':['cognito-idp:AdminGetUser'],'Resource':sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_njh6vaNWj')}]
 write_statements=[
 {'Effect':'Allow','Action':['dynamodb:ConditionCheckItem'],'Resource':[arn('Regions'),arn('RegionsDerived')]},
 {'Effect':'Allow','Action':['dynamodb:ConditionCheckItem'],'Resource':arn('PlatformStaff'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['EMPLOYEE#*']}}},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:Query','dynamodb:PutItem','dynamodb:DeleteItem','dynamodb:ConditionCheckItem'],'Resource':arn('PlatformStaff'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['REGIONS_PLAN#*','REGION_JOB#*','REGIONS_HISTORY#*','REGIONS_PUBLICATION#312']}}},
 {'Effect':'Allow','Action':['dynamodb:PutItem'],'Resource':arn('PlatformStaff'),'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['AUDIT']}}},
 {'Effect':'Allow','Action':['sqs:SendMessage'],'Resource':sub('arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:wizz-production-region-publication')}
 ]
 write_statements.insert(0, reference_count_policy(arn))
 statements += [{'Fn::If':['RegionWritesActive',s,{'Ref':'AWS::NoValue'}]} for s in write_statements]
 add('LogGroup','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':90});r['LogGroup'].update(DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
 add('Role','AWS::IAM::Role',{'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},'Policies':[{'PolicyName':'ProductionRegionAdministrationReadOnly','PolicyDocument':{'Version':'2012-10-17','Statement':statements}}]})
 add('Function','AWS::Lambda::Function',{'FunctionName':'wizz-production-region-api','Runtime':'nodejs22.x','Handler':'region-management/index.handler','MemorySize':512,'Timeout':25,'Role':{'Fn::GetAtt':['Role','Arn']},'Code':{'S3Bucket':'wizz-production-artifacts-746727375268-us-east-1','S3Key':{'Ref':'ArtifactKey'},'S3ObjectVersion':{'Ref':'ArtifactVersion'}},'Environment':{'Variables':{'ENVIRONMENT':'production','PLATFORM_ENVIRONMENT':'production','STAFF_TABLE':'wizz-production-PlatformStaff','REGION_MANAGEMENT_ENABLED':'true','REGION_WRITES_ENABLED':{'Ref':'WritesEnabled'},'REGION_COMPOSITE_READERS_READY':{'Ref':'ReadersReady'},'REGION_PUBLICATION_QUEUE_URL':sub('https://sqs.${AWS::Region}.amazonaws.com/${AWS::AccountId}/wizz-production-region-publication')}},'LoggingConfig':{'LogGroup':{'Ref':'LogGroup'}}})
 r['Function']['Properties']['Environment']['Variables'].update({**REFERENCE_ENV})
 add('Api','AWS::ApiGateway::RestApi',{'Name':'wizz-production-region-api','EndpointConfiguration':{'Types':['REGIONAL']}})
 for n,path,parent in [('Staff','staff',None),('Regions','regions','Staff'),('Manage','manage','Regions'),('History','history','Manage'),('Region','{regionId}','History'),('Jobs','jobs','Manage'),('Job','{jobId}','Jobs')]:
  add(n+'Resource','AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':{'Ref':parent+'Resource'} if parent else {'Fn::GetAtt':['Api','RootResourceId']},'PathPart':path})
 methods=[]
 for n in ('Manage','Region','Job'):
  add(n+'Method','AWS::ApiGateway::Method',{'RestApiId':{'Ref':'Api'},'ResourceId':{'Ref':n+'Resource'},'HttpMethod':'GET','AuthorizationType':'NONE','Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST','Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')}});methods.append(n+'Method')
 for n,path in [('Validate','validate'),('ValidatePlan','validate-plan'),('Draft','draft'),('Discard','discard'),('Cancel','cancel'),('Publish','publish')]:
  add(n+'Resource','AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':{'Ref':'ManageResource'},'PathPart':path})
  add(n+'Method','AWS::ApiGateway::Method',{'RestApiId':{'Ref':'Api'},'ResourceId':{'Ref':n+'Resource'},'HttpMethod':'POST','AuthorizationType':'NONE','Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST','Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')}});methods.append(n+'Method')
 add('WriteInvoke','AWS::Lambda::Permission',{'Action':'lambda:InvokeFunction','FunctionName':{'Ref':'Function'},'Principal':'apigateway.amazonaws.com','SourceAccount':{'Ref':'AWS::AccountId'},'SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/POST/staff/regions/manage/*')})
 add('Invoke','AWS::Lambda::Permission',{'Action':'lambda:InvokeFunction','FunctionName':{'Ref':'Function'},'Principal':'apigateway.amazonaws.com','SourceAccount':{'Ref':'AWS::AccountId'},'SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/GET/staff/regions/manage*')})
 add('DeploymentWithWrites','AWS::ApiGateway::Deployment',{'RestApiId':{'Ref':'Api'}});r['DeploymentWithWrites']['DependsOn']=methods
 add('Stage','AWS::ApiGateway::Stage',{'RestApiId':{'Ref':'Api'},'DeploymentId':{'Ref':'DeploymentWithWrites'},'StageName':'production','MethodSettings':[{'ResourcePath':'/*','HttpMethod':'*','ThrottlingBurstLimit':10,'ThrottlingRateLimit':5,'DataTraceEnabled':False}]})
 t['Outputs']={'ApiUrl':{'Value':sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/production')}}
 return t
if __name__=='__main__':(ROOT/'region-api.template.json').write_text(json.dumps(build(),indent=2)+'\n')
