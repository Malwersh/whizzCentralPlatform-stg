"""Isolated legal document administration, production account only."""
import json
from pathlib import Path
from prepare_driver_review_api import build as review
ROOT=Path(__file__).resolve().parent
def build():
 t=review();t['Description']='Production legal documents: isolated audience drafts, immutable published versions, independent approval.'
 t['Parameters'].pop('DriverReviewReadEnabled');t['Parameters']['ArtifactKey']['AllowedPattern']='legal-admin/[a-f0-9]{64}.zip'
 r=t['Resources'];keep=['LogGroup','Role','Function','Api','Stage'];t['Resources']=r={k:r[k] for k in keep}
 log='/aws/lambda/wizz-production-legal-admin'
 r['LogGroup']['Properties']['LogGroupName']=log
 p=r['Function']['Properties'];p['FunctionName']='wizz-production-legal-admin';p['Environment']['Variables']={'ENVIRONMENT':'production','PLATFORM_ENVIRONMENT':'production'}
 r['Api']['Properties']['Name']='wizz-production-legal-admin'
 sub=lambda x:{'Fn::Sub':x}
 table=sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-PlatformStaff')
 policy=r['Role']['Properties']['Policies'][0];policy['PolicyName']='LegalAdministrationOnly'
 policy['PolicyDocument']['Statement']=[{'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':table,'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['EMPLOYEE#*']}}},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:Query','dynamodb:PutItem','dynamodb:DeleteItem','dynamodb:ConditionCheckItem'],'Resource':table,'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['OPERATIONAL_SETTINGS#'+a+'_LEGAL' for a in ['CUSTOMER','DRIVER','MERCHANT']]}}},
 {'Effect':'Allow','Action':['dynamodb:PutItem'],'Resource':table,'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['AUDIT']}}},
 {'Effect':'Allow','Action':['cognito-idp:AdminGetUser'],'Resource':sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_njh6vaNWj')}]
 def add(n,kind,p):r[n]={'Type':kind,'Condition':'IsProductionAccount','Properties':p}
 for n,path,parent in [('Staff','staff',None),('Settings','settings','Staff'),('Legal','legal-documents','Settings'),('Audience','{audience}','Legal'),('Action','{action}','Audience'),('Version','{revision}','Action')]:
  add(n+'Resource','AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':{'Ref':parent+'Resource'} if parent else {'Fn::GetAtt':['Api','RootResourceId']},'PathPart':path})
 methods=[]
 for resource,method in [('Audience','GET'),('Action','GET'),('Action','POST'),('Version','GET')]:
  n=resource+method
  add(n+'Method','AWS::ApiGateway::Method',{'RestApiId':{'Ref':'Api'},'ResourceId':{'Ref':resource+'Resource'},'HttpMethod':method,'AuthorizationType':'NONE','Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST','Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')}});methods.append(n+'Method')
 add('Invoke','AWS::Lambda::Permission',{'Action':'lambda:InvokeFunction','FunctionName':{'Ref':'Function'},'Principal':'apigateway.amazonaws.com','SourceAccount':{'Ref':'AWS::AccountId'},'SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/*/staff/settings/legal-documents/*')})
 add('LegalDeployment','AWS::ApiGateway::Deployment',{'RestApiId':{'Ref':'Api'}});r['LegalDeployment']['DependsOn']=methods;r['Stage']['Properties']['DeploymentId']={'Ref':'LegalDeployment'}
 return t
if __name__=='__main__':(ROOT/'legal-admin-api.template.json').write_text(json.dumps(build(),indent=2)+'\n')
