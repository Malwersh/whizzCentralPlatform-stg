"""Internal-only production driver wallet creator; no public API or funding."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def build():
 base=json.loads((ROOT/'storage-auth.template.json').read_text())
 t={k:v for k,v in base.items() if k not in ('Resources','Outputs')}
 t['Description']='Internal driver wallet creation with lifecycle fencing; no funding.'
 t['Parameters'].update(ArtifactKey={'Type':'String','AllowedPattern':'driver-wallet/[a-f0-9]{64}.zip'},ArtifactVersion={'Type':'String','MinLength':1})
 t['Parameters']['WalletCreationEnabled']={'Type':'String','Default':'false','AllowedValues':['false','true']}
 def sub(x):return {'Fn::Sub':x}
 def table(x):return sub('arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-'+x)
 log='/aws/lambda/wizz-production-wallet-creation-trigger'
 statements=[{'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*')},{'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem'],'Resource':table('Wallets'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['WALLET#DRIVER#*']}}},{'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':table('AccountDeletion'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ACCOUNT_LIFECYCLE#DRIVER#*']}}}]
 t['Resources']={
 'LogGroup':{'Type':'AWS::Logs::LogGroup','DeletionPolicy':'Retain','UpdateReplacePolicy':'Retain','Properties':{'LogGroupName':log,'RetentionInDays':90}},
 'Role':{'Type':'AWS::IAM::Role','Properties':{'AssumeRolePolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]},'Policies':[{'PolicyName':'CreateDriverWalletOnly','PolicyDocument':{'Version':'2012-10-17','Statement':statements}}]}},
 'Function':{'Type':'AWS::Lambda::Function','Properties':{'FunctionName':'wizz-production-wallet-creation-trigger','Runtime':'nodejs22.x','Handler':'index.handler','MemorySize':128,'Timeout':15,'Role':{'Fn::GetAtt':['Role','Arn']},'Code':{'S3Bucket':'wizz-production-artifacts-746727375268-us-east-1','S3Key':{'Ref':'ArtifactKey'},'S3ObjectVersion':{'Ref':'ArtifactVersion'}},'Environment':{'Variables':{'ENVIRONMENT':'production','WALLET_CREATION_ENABLED':{'Ref':'WalletCreationEnabled'}}},'LoggingConfig':{'LogGroup':{'Ref':'LogGroup'}}}}}
 for r in t['Resources'].values():r['Condition']='IsProductionAccount'
 return t
if __name__=='__main__':(ROOT/'driver-wallet.template.json').write_text(json.dumps(build(),indent=2)+'\n')
