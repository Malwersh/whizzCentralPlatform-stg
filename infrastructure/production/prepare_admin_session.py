"""Prepare the limited production admin session service; does not deploy or invite users."""
import json
from pathlib import Path
from prepare_driver_review_api import build as review_build
ROOT=Path(__file__).resolve().parent
def build():
 t=review_build();t['Description']='Production administrator identity and MFA enrollment only; initially disabled.'
 t['Parameters']['ArtifactKey']['AllowedPattern']='admin-session/[a-f0-9]{64}.zip'
 t['Parameters']['AdminSessionEnabled']={'Type':'String','Default':'false','AllowedValues':['false','true']}
 t['Parameters'].pop('DriverReviewReadEnabled',None)
 r=t['Resources']
 r['Deployment']=r.pop('DirectoryDeployment')
 r['Stage']['Properties']['DeploymentId']={'Ref':'Deployment'}
 for k in list(r):
  if k not in ['LogGroup','Role','Function','Api','Deployment','Stage']:del r[k]
 log='/aws/lambda/wizz-production-admin-session'
 r['LogGroup']['Properties']['LogGroupName']=log
 role=r['Role']['Properties'];policy=role['Policies'][0];policy['PolicyName']='OwnAdministratorSessionAndEnrollment'
 sub=lambda s:{'Fn::Sub':s}
 table=sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-PlatformStaff')
 policy['PolicyDocument']['Statement']=[
  {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')},
  {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:UpdateItem'],'Resource':table,'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['EMPLOYEE#*']}}},
  {'Effect':'Allow','Action':['dynamodb:PutItem'],'Resource':table,'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['AUDIT']}}},
  {'Effect':'Allow','Action':['cognito-idp:AdminGetUser'],'Resource':sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_njh6vaNWj')}]
 f=r['Function']['Properties'];f['FunctionName']='wizz-production-admin-session';f['Environment']['Variables']={'ENVIRONMENT':'production','ADMIN_SESSION_ENABLED':{'Ref':'AdminSessionEnabled'}}
 r['Api']['Properties']['Name']='wizz-production-admin-session'
 def add(n,kind,p):r[n]={'Type':kind,'Condition':'IsProductionAccount','Properties':p}
 for n,path,parent in [('Staff','staff',None),('Me','me','Staff'),('Enrollment','enrollment','Staff'),('Finish','finish','Enrollment')]:
  add(n+'Resource','AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':{'Ref':parent+'Resource'} if parent else {'Fn::GetAtt':['Api','RootResourceId']},'PathPart':path})
 methods=[]
 for n,verb,path in [('Me','GET','me'),('Finish','POST','enrollment/finish')]:
  add(n+'Method','AWS::ApiGateway::Method',{'RestApiId':{'Ref':'Api'},'ResourceId':{'Ref':n+'Resource'},'HttpMethod':verb,'AuthorizationType':'NONE','Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST','Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')}})
  add(n+'Invoke','AWS::Lambda::Permission',{'Action':'lambda:InvokeFunction','FunctionName':{'Ref':'Function'},'Principal':'apigateway.amazonaws.com','SourceAccount':{'Ref':'AWS::AccountId'},'SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+verb+'/staff/'+path)})
  methods.append(n+'Method')
 r['Deployment']['DependsOn']=methods
 return t
if __name__=='__main__':(ROOT/'admin-session-api.template.json').write_text(json.dumps(build(),indent=2)+'\n')
