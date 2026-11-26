"""Authenticated driver profile, vehicle management and private documents."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def build():
 base=json.loads((ROOT/'storage-auth.template.json').read_text());t={k:v for k,v in base.items() if k not in ['Resources','Outputs']};t['Description']='Production driver onboarding, vehicle management and private document upload.'
 t['Parameters'].update(ArtifactKey={'Type':'String','AllowedPattern':'driver-profile/[a-f0-9]{64}.zip'},ArtifactVersion={'Type':'String','MinLength':1})
 t['Parameters']['ProfileApiEnabled']={'Type':'String','Default':'false','AllowedValues':['false','true']}
 def sub(s):return {'Fn::Sub':s}
 def table(n):return sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-'+n)
 log='/aws/lambda/wizz-production-driver-profile';bucket='wizz-production-driver-documents-746727375268-us-east-1'
 statements=[{'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')},{'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem'],'Resource':table('Drivers')},{'Effect':'Allow','Action':['dynamodb:Scan','dynamodb:ConditionCheckItem'],'Resource':table('RegionsDerived')},{'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':table('DriverLiveState')},{'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':table('PlatformStaff'),'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['OPERATIONAL_SETTINGS#DRIVER_LEGAL']}}},{'Effect':'Allow','Action':['dynamodb:ConditionCheckItem','dynamodb:PutItem','dynamodb:DeleteItem'],'Resource':table('AccountDeletion'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ACCOUNT_LIFECYCLE#DRIVER#*','ACCOUNT_OPERATION#DRIVER#*']}}},{'Effect':'Allow','Action':['s3:PutObject','s3:GetObject'],'Resource':sub('arn:${AWS::Partition}:s3:::'+bucket+'/drivers/*')}]
 r={};t['Resources']=r
 def add(n,kind,p):r[n]={'Type':kind,'Condition':'IsProductionAccount','Properties':p}
 add('LogGroup','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':90});r['LogGroup'].update(DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
 add('Role','AWS::IAM::Role',{'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},'Policies':[{'PolicyName':'DriverOnboardingOnly','PolicyDocument':{'Version':'2012-10-17','Statement':statements}}]})
 add('Function','AWS::Lambda::Function',{'FunctionName':'wizz-production-driver-profile','Runtime':'nodejs22.x','Handler':'index.handler','MemorySize':256,'Timeout':25,'Role':{'Fn::GetAtt':['Role','Arn']},'Code':{'S3Bucket':'wizz-production-artifacts-746727375268-us-east-1','S3Key':{'Ref':'ArtifactKey'},'S3ObjectVersion':{'Ref':'ArtifactVersion'}},'Environment':{'Variables':{'ENVIRONMENT':'production','PROFILE_API_ENABLED':{'Ref':'ProfileApiEnabled'}}},'LoggingConfig':{'LogGroup':{'Ref':'LogGroup'}}})
 add('Api','AWS::ApiGateway::RestApi',{'Name':'wizz-production-driver-profile','EndpointConfiguration':{'Types':['REGIONAL']}})
 add('Authorizer','AWS::ApiGateway::Authorizer',{'Name':'ProductionDriverPoolOnly','RestApiId':{'Ref':'Api'},'Type':'COGNITO_USER_POOLS','IdentitySource':'method.request.header.Authorization','ProviderARNs':[sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_5sUT54eCB')]})
 add('DriverResource','AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':{'Fn::GetAtt':['Api','RootResourceId']},'PathPart':'driver'})
 for n,path,parent in [('Me','me','DriverResource'),('Options','registration-options','DriverResource'),('Legal','legal','DriverResource'),('Documents','documents','DriverResource'),('Upload','upload','DocumentsResource'),('Vehicles','vehicles','DriverResource'),('VehicleDocuments','documents','VehiclesResource')]:add(n+'Resource','AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':{'Ref':parent},'PathPart':path})
 methods=[]
 for n,resource,method,route in [('Read','Me','GET','me'),('Update','Me','PUT','me'),('Options','Options','GET','registration-options'),('Legal','Legal','GET','legal'),('Upload','Upload','POST','documents/upload'),('VehicleRead','Vehicles','GET','vehicles'),('VehicleUpdate','Vehicles','POST','vehicles'),('VehicleUpload','VehicleDocuments','POST','vehicles/documents')]:
  add(n+'Method','AWS::ApiGateway::Method',{'RestApiId':{'Ref':'Api'},'ResourceId':{'Ref':resource+'Resource'},'HttpMethod':method,'AuthorizationType':'COGNITO_USER_POOLS','AuthorizerId':{'Ref':'Authorizer'},'Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST','Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')}});methods.append(n+'Method')
  add(n+'Invoke','AWS::Lambda::Permission',{'Action':'lambda:InvokeFunction','FunctionName':{'Ref':'Function'},'Principal':'apigateway.amazonaws.com','SourceAccount':{'Ref':'AWS::AccountId'},'SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+method+'/driver/'+route)})
 add('Deployment','AWS::ApiGateway::Deployment',{'RestApiId':{'Ref':'Api'}});r['Deployment']['DependsOn']=[n for n in methods if not n.startswith('Vehicle')]
 add('VehicleDeployment','AWS::ApiGateway::Deployment',{'RestApiId':{'Ref':'Api'}});r['VehicleDeployment']['DependsOn']=methods
 add('Stage','AWS::ApiGateway::Stage',{'RestApiId':{'Ref':'Api'},'DeploymentId':{'Ref':'VehicleDeployment'},'StageName':'production','MethodSettings':[{'ResourcePath':'/*','HttpMethod':'*','ThrottlingBurstLimit':10,'ThrottlingRateLimit':5,'DataTraceEnabled':False}]})
 t['Outputs']={'ApiUrl':{'Value':sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/production')}};return t
if __name__=='__main__':(ROOT/'driver-profile-api.template.json').write_text(json.dumps(build(),indent=2)+'\n')
