"""Build isolated, initially disabled merchant personal-profile deployment."""
import hashlib,json,zipfile,io
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def package():
 files={n:(ROOT/'merchant-profile'/n).read_bytes() for n in ['index.cjs','authenticate.cjs','personal-profile.cjs']}
 files['personal-profile.cjs']=files['personal-profile.cjs'].replace(b"../../../backend/shared/customer-legal-contract-344",b"./customer-legal-contract-344")
 for n in ['customer-legal-contract-344.js','customer-legal-defaults-344.json','driver-legal-defaults-344.json','merchant-legal-defaults-344.json']:
  files[n]=(ROOT.parents[1]/'backend/shared'/n).read_bytes()
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for n,b in sorted(files.items()):
   i=zipfile.ZipInfo(n,date_time=(2026,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;z.writestr(i,b)
 return out.getvalue()

def build():
 base=json.loads((ROOT/'storage-auth.template.json').read_text());t={k:v for k,v in base.items() if k not in ['Resources','Outputs']}
 t['Description']='Production merchant personal profile, exact pool identity and pinned legal consent; initially disabled.'
 t['Parameters'].update(ArtifactKey={'Type':'String','AllowedPattern':'merchant-profile/[a-f0-9]{64}.zip'},ArtifactVersion={'Type':'String','MinLength':1})
 t['Parameters']['ProfileApiEnabled']={'Type':'String','Default':'false','AllowedValues':['false','true']}
 sub=lambda s:{'Fn::Sub':s}
 table=lambda n:sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-'+n)
 log='/aws/lambda/wizz-production-merchant-profile'
 statements=[{'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')},
 {'Effect':'Allow','Action':['cognito-idp:AdminGetUser'],'Resource':sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_2sKZ4fGbZ')},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem'],'Resource':table('MerchantPlatform'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['PERSON#*']}}},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':table('AccountDeletion'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ACCOUNT_LIFECYCLE#MERCHANT#*']}}},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':table('PlatformStaff'),'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['OPERATIONAL_SETTINGS#MERCHANT_LEGAL']}}}]
 r={};t['Resources']=r
 def add(n,kind,p):r[n]={'Type':kind,'Condition':'IsProductionAccount','Properties':p}
 add('LogGroup','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':90});r['LogGroup'].update(DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
 add('Role','AWS::IAM::Role',{'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},'Policies':[{'PolicyName':'MerchantPersonalProfileOnly','PolicyDocument':{'Version':'2012-10-17','Statement':statements}}]})
 add('Function','AWS::Lambda::Function',{'FunctionName':'wizz-production-merchant-profile','Runtime':'nodejs22.x','Handler':'index.handler','MemorySize':256,'Timeout':15,'Role':{'Fn::GetAtt':['Role','Arn']},'Code':{'S3Bucket':'wizz-production-artifacts-746727375268-us-east-1','S3Key':{'Ref':'ArtifactKey'},'S3ObjectVersion':{'Ref':'ArtifactVersion'}},'Environment':{'Variables':{'ENVIRONMENT':'production','PROFILE_API_ENABLED':{'Ref':'ProfileApiEnabled'}}},'LoggingConfig':{'LogGroup':{'Ref':'LogGroup'}}})
 add('Api','AWS::ApiGateway::RestApi',{'Name':'wizz-production-merchant-profile','EndpointConfiguration':{'Types':['REGIONAL']}})
 add('Authorizer','AWS::ApiGateway::Authorizer',{'Name':'ProductionMerchantPoolOnly','RestApiId':{'Ref':'Api'},'Type':'COGNITO_USER_POOLS','IdentitySource':'method.request.header.Authorization','ProviderARNs':[sub('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_2sKZ4fGbZ')]})
 add('Auth','AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':{'Fn::GetAtt':['Api','RootResourceId']},'PathPart':'auth'})
 add('Profile','AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':{'Ref':'Auth'},'PathPart':'person-profile'})
 for method in ['GET','POST']:
  add(method+'Method','AWS::ApiGateway::Method',{'RestApiId':{'Ref':'Api'},'ResourceId':{'Ref':'Profile'},'HttpMethod':method,'AuthorizationType':'COGNITO_USER_POOLS','AuthorizerId':{'Ref':'Authorizer'},'Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST','Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')}})
  add(method+'Invoke','AWS::Lambda::Permission',{'Action':'lambda:InvokeFunction','FunctionName':{'Ref':'Function'},'Principal':'apigateway.amazonaws.com','SourceAccount':{'Ref':'AWS::AccountId'},'SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+method+'/auth/person-profile')})
 add('Deployment','AWS::ApiGateway::Deployment',{'RestApiId':{'Ref':'Api'}});r['Deployment']['DependsOn']=['GETMethod','POSTMethod']
 add('Stage','AWS::ApiGateway::Stage',{'RestApiId':{'Ref':'Api'},'DeploymentId':{'Ref':'Deployment'},'StageName':'production','MethodSettings':[{'ResourcePath':'/*','HttpMethod':'*','ThrottlingBurstLimit':10,'ThrottlingRateLimit':5,'DataTraceEnabled':False}]})
 t['Outputs']={'ApiUrl':{'Value':sub('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/production')}}
 return t
if __name__=='__main__':
 raw=package();digest=hashlib.sha256(raw).hexdigest();target=Path('/private/tmp/wizz-production-merchant-profile-'+digest+'.zip');target.write_bytes(raw)
 (ROOT/'merchant-profile-api.template.json').write_text(json.dumps(build(),indent=2)+'\n')
 print(json.dumps({'artifact':str(target),'sha256':digest,'status':'PREPARED_DISABLED_NOT_DEPLOYED'}))
