"""Production-only driver review API. JWT access tokens verified inside every handler."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def build(include_performance=True):
 base=json.loads((ROOT/'storage-auth.template.json').read_text());t={k:v for k,v in base.items() if k not in ['Resources','Outputs']};t['Description']='Production administration driver reviews and temporary private document view. Runtime JWT plus live staff checks. Initially disabled.'
 t['Parameters'].update(DriverReviewReadEnabled={'Type':'String','Default':'false','AllowedValues':['false','true']},DriverReviewWritesEnabled={'Type':'String','Default':'false','AllowedValues':['false','true']},ArtifactKey={'Type':'String','AllowedPattern':'driver-review/[a-f0-9]{64}.zip'},ArtifactVersion={'Type':'String','MinLength':1})
 def sub(s):return {'Fn::Sub':s}
 def table(n):return sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-'+n)
 log='/aws/lambda/wizz-production-driver-review';pool=sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_njh6vaNWj')
 statements=[{'Effect':'Allow','Action':['dynamodb:Scan'],'Resource':table('Drivers')},{'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:UpdateItem','dynamodb:ConditionCheckItem'],'Resource':table('Drivers')},
 {'Effect':'Allow','Action':['dynamodb:Scan','dynamodb:ConditionCheckItem'],'Resource':table('RegionsDerived')},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':table('PlatformStaff'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['EMPLOYEE#*']}}},
 {'Effect':'Allow','Action':['dynamodb:PutItem'],'Resource':table('PlatformStaff'),'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['AUDIT']}}},
 {'Effect':'Allow','Action':['dynamodb:ConditionCheckItem'],'Resource':table('AccountDeletion'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ACCOUNT_LIFECYCLE#DRIVER#*']}}},
 {'Effect':'Allow','Action':['cognito-idp:AdminGetUser'],'Resource':pool},
 {'Effect':'Allow','Action':['s3:GetObject','s3:GetObjectVersion'],'Resource':sub('arn:${AWS::Partition}:s3:::wizz-production-driver-documents-746727375268-us-east-1/drivers/*')}]
 if include_performance:
  statements.extend([
   {'Effect':'Allow','Action':'dynamodb:GetItem','Resource':table('DriverPerformanceSnapshots'),
    'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['DRIVER#*','CONTROL']}}},
   {'Effect':'Allow','Action':'dynamodb:GetItem','Resource':table('AccountDeletion'),
    'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ACCOUNT_LIFECYCLE#DRIVER#*','SUBJECT#DRIVER#*']}}},
  ])
 r={};t['Resources']=r
 def add(n,kind,p):r[n]={'Type':kind,'Condition':'IsProductionAccount','Properties':p}
 add('LogGroup','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':90});r['LogGroup'].update(DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
 add('Role','AWS::IAM::Role',{'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},'Policies':[{'PolicyName':'DriverAdministrativeReviewOnly','PolicyDocument':{'Version':'2012-10-17','Statement':statements}}]})
 add('Function','AWS::Lambda::Function',{'FunctionName':'wizz-production-driver-review','Runtime':'nodejs22.x','Handler':'index.handler','MemorySize':256,'Timeout':25,'Role':{'Fn::GetAtt':['Role','Arn']},'Code':{'S3Bucket':'wizz-production-artifacts-746727375268-us-east-1','S3Key':{'Ref':'ArtifactKey'},'S3ObjectVersion':{'Ref':'ArtifactVersion'}},'Environment':{'Variables':{'ENVIRONMENT':'production','DRIVER_REVIEW_ENABLED':{'Ref':'DriverReviewWritesEnabled'},'DRIVER_REVIEW_READ_ENABLED':{'Ref':'DriverReviewReadEnabled'}}},'LoggingConfig':{'LogGroup':{'Ref':'LogGroup'}}})
 add('Api','AWS::ApiGateway::RestApi',{'Name':'wizz-production-driver-review','EndpointConfiguration':{'Types':['REGIONAL']}})
 paths=[('Staff','staff',None),('Drivers','drivers','Staff'),('Driver','{driverId}','Drivers'),('Vehicles','vehicles','Driver'),('Documents','documents','Driver'),('View','view','Documents')]
 if include_performance:paths.extend([('Performance','performance','Driver'),('Deletion','account-deletion','Driver')])
 for n,path,parent in paths:
  add(n+'Resource','AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':{'Ref':parent+'Resource'} if parent else {'Fn::GetAtt':['Api','RootResourceId']},'PathPart':path})
 methods=[]
 routes=[('Directory','Drivers','GET',''),('Read','Vehicles','GET','vehicles'),('Review','Vehicles','POST','vehicles'),('View','View','GET','documents/view')]
 if include_performance:routes.extend([('Performance','Performance','GET','performance'),('Deletion','Deletion','GET','account-deletion')])
 for n,resource,method,route in routes:
  add(n+'Method','AWS::ApiGateway::Method',{'RestApiId':{'Ref':'Api'},'ResourceId':{'Ref':resource+'Resource'},'HttpMethod':method,'AuthorizationType':'NONE','Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST','Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')}});methods.append(n+'Method')
  add(n+'Invoke','AWS::Lambda::Permission',{'Action':'lambda:InvokeFunction','FunctionName':{'Ref':'Function'},'Principal':'apigateway.amazonaws.com','SourceAccount':{'Ref':'AWS::AccountId'},'SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+method+('/staff/drivers/*/'+route if route else '/staff/drivers'))})
 deployment='AccountDeletionDeployment' if include_performance else 'DirectoryDeployment'
 add(deployment,'AWS::ApiGateway::Deployment',{'RestApiId':{'Ref':'Api'}});r[deployment]['DependsOn']=methods
 add('Stage','AWS::ApiGateway::Stage',{'RestApiId':{'Ref':'Api'},'DeploymentId':{'Ref':deployment},'StageName':'production','MethodSettings':[{'ResourcePath':'/*','HttpMethod':'*','ThrottlingBurstLimit':10,'ThrottlingRateLimit':5,'DataTraceEnabled':False}]})
 t['Outputs']={'ApiUrl':{'Value':sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/production')}};return t
if __name__=='__main__':(ROOT/'driver-review-api.template.json').write_text(json.dumps(build(),indent=2)+'\n')
