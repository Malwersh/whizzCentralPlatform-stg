"""Isolated merchant onboarding administration, production account only."""
import json
from pathlib import Path
from prepare_driver_review_api import build as review
ROOT=Path(__file__).resolve().parent
def build():
 t=review();t['Description']='Production merchant onboarding configuration: versioned settings and audited administrator writes.'
 t['Parameters'].pop('DriverReviewReadEnabled');t['Parameters']['ArtifactKey']['AllowedPattern']='merchant-onboarding-admin/[a-f0-9]{64}.zip'
 r=t['Resources'];keep=['LogGroup','Role','Function','Api','Stage'];t['Resources']=r={k:r[k] for k in keep}
 log='/aws/lambda/wizz-production-merchant-onboarding-admin'
 r['LogGroup']['Properties']['LogGroupName']=log
 p=r['Function']['Properties'];p['FunctionName']='wizz-production-merchant-onboarding-admin';p['Environment']['Variables']={'ENVIRONMENT':'production','PLATFORM_ENVIRONMENT':'production'}
 r['Api']['Properties']['Name']='wizz-production-merchant-onboarding-admin'
 sub=lambda x:{'Fn::Sub':x}
 table=sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-PlatformStaff')
 policy=r['Role']['Properties']['Policies'][0];policy['PolicyName']='MerchantOnboardingAdministrationOnly'
 policy['PolicyDocument']['Statement']=[{'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':table,'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['EMPLOYEE#*']}}},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem','dynamodb:ConditionCheckItem'],'Resource':table,'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING']}}},
 {'Effect':'Allow','Action':['dynamodb:PutItem'],'Resource':table,'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['AUDIT']}}},
 {'Effect':'Allow','Action':['cognito-idp:AdminGetUser'],'Resource':sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_njh6vaNWj')}]
 def add(n,kind,p):r[n]={'Type':kind,'Condition':'IsProductionAccount','Properties':p}
 for n,path,parent in [('Staff','staff',None),('Merchants','merchants','Staff'),('Onboarding','onboarding','Merchants'),('Action','{action}','Onboarding')]:
  add(n+'Resource','AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':{'Ref':parent+'Resource'} if parent else {'Fn::GetAtt':['Api','RootResourceId']},'PathPart':path})
 methods=[]
 for resource,method in [('Onboarding','GET'),('Action','POST')]:
  n=resource+method
  add(n+'Method','AWS::ApiGateway::Method',{'RestApiId':{'Ref':'Api'},'ResourceId':{'Ref':resource+'Resource'},'HttpMethod':method,'AuthorizationType':'NONE','Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST','Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')}});methods.append(n+'Method')
 add('Invoke','AWS::Lambda::Permission',{'Action':'lambda:InvokeFunction','FunctionName':{'Ref':'Function'},'Principal':'apigateway.amazonaws.com','SourceAccount':{'Ref':'AWS::AccountId'},'SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/*/staff/merchants/onboarding*')})
 add('OnboardingDeployment','AWS::ApiGateway::Deployment',{'RestApiId':{'Ref':'Api'}});r['OnboardingDeployment']['DependsOn']=methods;r['Stage']['Properties']['DeploymentId']={'Ref':'OnboardingDeployment'}
 return t
if __name__=='__main__':(ROOT/'merchant-onboarding-admin-api.template.json').write_text(json.dumps(build(),indent=2)+'\n')
