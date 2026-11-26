"""Production customer enrollment infrastructure."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def build():
 base=json.loads((ROOT/'storage-auth.template.json').read_text())
 t={k:v for k,v in base.items() if k not in ('Resources','Outputs')};t['Description']='Isolated production customer enrollment API.';t['Resources']={}
 t['Parameters'].update(ArtifactKey={'Type':'String','AllowedPattern':'customer-enrollment/[a-f0-9]{64}.zip'},ArtifactVersion={'Type':'String','MinLength':1},OtpSecretArn={'Type':'String','AllowedPattern':'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/customer/otp-[A-Za-z0-9]+'})
 t['Parameters']['OtpEnabled']={'Type':'String','Default':'false','AllowedValues':['false','true']}
 def add(n,k,p,retain=False):
  t['Resources'][n]={'Type':k,'Condition':'IsProductionAccount','Properties':p}
  if retain:t['Resources'][n].update(DeletionPolicy='Retain',UpdateReplacePolicy='Retain')
 def arn(s):return {'Fn::Sub':s}
 def table(n):return arn('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-'+n)
 pool=arn('arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_rNtNKVsVf')
 log='/aws/lambda/wizz-production-customer-enrollment'
 add('LogGroup','AWS::Logs::LogGroup',{'LogGroupName':log,'RetentionInDays':90},True)
 statements=[
 {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':arn('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem'],'Resource':table('CustomerPhoneAuth')},
 {'Effect':'Allow','Action':['dynamodb:ConditionCheckItem'],'Resource':table('CustomerPhoneAuth'),
  'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ACTIVE#*']},'Null':{'dynamodb:LeadingKeys':'false'}}},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem'],'Resource':table('Customers')},
 {'Effect':'Allow','Action':['dynamodb:Query'],'Resource':[arn('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-Customers/index/'+x) for x in ['phone-index','email-index']]},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem'],'Resource':table('Wallets'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['WALLET#CUSTOMER#*']}}},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':table('AccountDeletion'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ACCOUNT_LIFECYCLE#CUSTOMER#*']}}},
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':table('PlatformStaff'),'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['OPERATIONAL_SETTINGS#'+a+'_LEGAL' for a in ['CUSTOMER','DRIVER','MERCHANT']]}}},
 {'Effect':'Allow','Action':['secretsmanager:GetSecretValue'],'Resource':{'Ref':'OtpSecretArn'}},
 {'Effect':'Allow','Action':['cognito-idp:'+a for a in ['ListUsers','AdminCreateUser','AdminSetUserPassword','AdminInitiateAuth','AdminRespondToAuthChallenge']],'Resource':pool}]
 add('Role','AWS::IAM::Role',{'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},'Policies':[{'PolicyName':'CustomerEnrollmentOnly','PolicyDocument':{'Version':'2012-10-17','Statement':statements}}]})
 env={'ENVIRONMENT':'production','OTP_ENABLED':{'Ref':'OtpEnabled'},'USER_POOL_ID':'us-east-1_rNtNKVsVf','CLIENT_ID':'3e8p0ouglrprpd0a3pc91du0hg','OTP_TABLE':'wizz-production-CustomerPhoneAuth','USERS_TABLE':'wizz-production-Customers','WALLETS_TABLE':'wizz-production-Wallets','DELETION_TABLE':'wizz-production-AccountDeletion','LEGAL_SETTINGS_TABLE':'wizz-production-PlatformStaff','OTP_SECRET_ARN':{'Ref':'OtpSecretArn'}}
 add('Function','AWS::Lambda::Function',{'FunctionName':'wizz-production-customer-enrollment','Runtime':'nodejs22.x','Handler':'index.handler','MemorySize':256,'Timeout':25,'Role':{'Fn::GetAtt':['Role','Arn']},'Code':{'S3Bucket':'wizz-production-artifacts-746727375268-us-east-1','S3Key':{'Ref':'ArtifactKey'},'S3ObjectVersion':{'Ref':'ArtifactVersion'}},'Environment':{'Variables':env},'LoggingConfig':{'LogGroup':{'Ref':'LogGroup'}}})
 add('Api','AWS::ApiGateway::RestApi',{'Name':'wizz-production-customer-enrollment','EndpointConfiguration':{'Types':['REGIONAL']},'DisableExecuteApiEndpoint':False})
 parent={'Fn::GetAtt':['Api','RootResourceId']}
 for name,path in [('AuthResource','auth'),('PhoneResource','phone')]:
  add(name,'AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':parent,'PathPart':path});parent={'Ref':name}
 methods=[]
 for name,path,method in [('Send','send','POST'),('Verify','verify','POST'),('Legal','legal','GET')]:
  add(name+'Resource','AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':{'Fn::GetAtt':['Api','RootResourceId']} if name=='Legal' else parent,'PathPart':path})
  add(name+'Method','AWS::ApiGateway::Method',{'RestApiId':{'Ref':'Api'},'ResourceId':{'Ref':name+'Resource'},'HttpMethod':method,'AuthorizationType':'NONE','Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST','Uri':arn('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')}});methods.append(name+'Method')
  route='legal' if name=='Legal' else 'auth/phone/'+path
  add(name+'Invoke','AWS::Lambda::Permission',{'Action':'lambda:InvokeFunction','FunctionName':{'Ref':'Function'},'Principal':'apigateway.amazonaws.com','SourceAccount':{'Ref':'AWS::AccountId'},'SourceArn':arn('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+method+'/'+route)})
 add('Deployment','AWS::ApiGateway::Deployment',{'RestApiId':{'Ref':'Api'}});t['Resources']['Deployment']['DependsOn']=methods
 add('Stage','AWS::ApiGateway::Stage',{'RestApiId':{'Ref':'Api'},'DeploymentId':{'Ref':'Deployment'},'StageName':'production','TracingEnabled':False,'MethodSettings':[{'ResourcePath':'/*','HttpMethod':'*','ThrottlingBurstLimit':10,'ThrottlingRateLimit':5,'DataTraceEnabled':False}]})
 t['Outputs']={'ApiUrl':{'Value':arn('https://${Api}.execute-api.${AWS::Region}.amazonaws.com/production')}}
 return t

def artifacts():
 base=json.loads((ROOT/'foundation.template.json').read_text());t={k:v for k,v in base.items() if k not in ('Resources','Outputs')};name='wizz-production-artifacts-746727375268-us-east-1'
 t['Resources']={'Artifacts':{'Type':'AWS::S3::Bucket','Condition':'IsProductionAccount','DeletionPolicy':'Retain','UpdateReplacePolicy':'Retain','Properties':{'BucketName':name,'VersioningConfiguration':{'Status':'Enabled'},'BucketEncryption':{'ServerSideEncryptionConfiguration':[{'ServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]},'PublicAccessBlockConfiguration':{'BlockPublicAcls':True,'BlockPublicPolicy':True,'IgnorePublicAcls':True,'RestrictPublicBuckets':True},'OwnershipControls':{'Rules':[{'ObjectOwnership':'BucketOwnerEnforced'}]}}},'TlsOnly':{'Type':'AWS::S3::BucketPolicy','Condition':'IsProductionAccount','Properties':{'Bucket':{'Ref':'Artifacts'},'PolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Deny','Principal':'*','Action':'s3:*','Resource':[{'Fn::GetAtt':['Artifacts','Arn']},{'Fn::Sub':'${Artifacts.Arn}/*'}],'Condition':{'Bool':{'aws:SecureTransport':'false'}}}]}}}}
 t['Description']='Private versioned production deployment artifacts only.';return t
if __name__=='__main__':
 for name,t in [('customer-enrollment',build()),('artifacts',artifacts())]:(ROOT/(name+'.template.json')).write_text(json.dumps(t,indent=2)+'\n')
