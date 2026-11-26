import json
from pathlib import Path
p=Path(__file__).resolve().parent
base=json.loads((p/'driver-wallet.template.json').read_text())
base['Description']='Production wallet identity authorizer; no public routes or balance writes.'
base['Parameters']['ArtifactKey']['AllowedPattern']='wallet-authorizer/[a-f0-9]{64}.zip'
r=base['Resources'];log='/aws/lambda/wizz-production-wallet-authorizer'
r['LogGroup']['Properties']['LogGroupName']=log
r['Role']['Properties']['Policies']=[{'PolicyName':'WalletIdentityReadOnly','PolicyDocument':{'Version':'2012-10-17','Statement':[
{'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':{'Fn::Sub':'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*'}},
{'Effect':'Allow','Action':['dynamodb:GetItem'],'Resource':{'Fn::Sub':'arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-PlatformStaff'},'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['EMPLOYEE#*']}}},
{'Effect':'Allow','Action':['cognito-idp:AdminGetUser'],'Resource':{'Fn::Sub':'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/us-east-1_njh6vaNWj'}}]}}]
f=r['Function']['Properties'];f.update(FunctionName='wizz-production-wallet-authorizer',Runtime='python3.12',Handler='wallet_authorizer_entry.lambda_handler',MemorySize=256,Timeout=20)
env=json.loads((p/'wallet-receipt-runtime.json').read_text())['environment']
f['Environment']['Variables']={k:v for k,v in env.items() if k.endswith('_USER_POOL_ID') or k.endswith('_CLIENT_ID') or k in ('REGION','ENVIRONMENT','STAFF_TABLE')}
(p/'wallet-authorizer.template.json').write_text(json.dumps(base,indent=2)+'\n')
