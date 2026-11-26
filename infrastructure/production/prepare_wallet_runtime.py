"""Internal production wallet runtime: approved funding configuration and topup review."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def build():
 base=json.loads((ROOT/'driver-wallet.template.json').read_text())
 base['Description']='Internal production wallet runtime; scoped funding configuration and approved topup review IAM.'
 base['Parameters']['ArtifactKey']['AllowedPattern']='wallet-runtime/[a-f0-9]{64}.zip'
 r=base['Resources']; log='/aws/lambda/wizz-production-wallet-service'
 r['LogGroup']['Properties']['LogGroupName']=log
 def arn(table):return {'Fn::Sub':'arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-'+table}
 statements=[{'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':{'Fn::Sub':'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:'+log+':*'}}]
 config_keys=[
  'CONFIG#FUNDING',
  'CONFIG#TRANSFERS',
  'CONFIG#TRANSFERS_PENDING',
  'CONFIG#WALLET_OPERATING_LIMITS',
  'CONFIG#WALLET_OPERATING_LIMITS_PENDING',
 ]
 for table,actions,keys in [('Wallets',['dynamodb:GetItem'],['WALLET#DRIVER#*']),('LedgerEntries',['dynamodb:Query'],['WALLET#DRIVER#*','WALLET#PLATFORM']),('IdempotencyKeys',['dynamodb:GetItem'],config_keys)]:
  statements.append({'Effect':'Allow','Action':actions,'Resource':arn(table),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':keys}}})
 statements.append({'Effect':'Allow','Action':['dynamodb:Query'],'Resource':arn('TopupRequests/index/byStatus'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['PENDING','APPROVED','POSTED','REJECTED','CANCELED']}}})
 statements.append({'Effect':'Allow','Action':['dynamodb:Scan'],'Resource':arn('Wallets'),'Condition':{'ForAllValues:StringEquals':{'dynamodb:Attributes':['walletId','sk','ownerId','ownerType','currency','status','availableBalance','lockedBalance','updatedAt']},'StringEquals':{'dynamodb:Select':'SPECIFIC_ATTRIBUTES'}}})
 statements.append({'Effect':'Allow','Action':['s3:GetObject'],'Resource':{'Fn::Sub':'arn:${AWS::Partition}:s3:::wizz-production-funding-receipts-${AWS::AccountId}-${AWS::Region}/receipts/*'},'Condition':{'StringEquals':{'s3:ResourceAccount':{'Ref':'AWS::AccountId'}}}})
 statements.append({'Effect':'Allow','Action':['dynamodb:Query'],'Resource':arn('WalletNotifications/index/ByDriver'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['????????-????-????-????-????????????']}}})
 r['Role']['Properties']['Policies']=[{'PolicyName':'WalletRuntimeReadOnly','PolicyDocument':{'Version':'2012-10-17','Statement':statements}}]
 policy=json.loads((ROOT.parent.parent/'docs/production-funding-config-write-policy-2026-11-18.json').read_text())
 r['Role']['Properties']['Policies'].append({'PolicyName':'FundingConfigurationWriteOnly','PolicyDocument':policy})
 review=json.loads((ROOT.parent.parent/'docs/production-topup-review-write-policy-2026-11-18.json').read_text())
 r['Role']['Properties']['Policies'].append({'PolicyName':'TopupReviewWrite','PolicyDocument':review})
 f=r['Function']['Properties'];f.update(FunctionName='wizz-production-wallet-service',Runtime='nodejs22.x',Handler='index.handler',MemorySize=256,Timeout=20)
 f['Environment']['Variables']=json.loads((ROOT/'wallet-receipt-runtime.json').read_text())['environment']
 f['Environment']['Variables']['MERCHANT_OWNER_FINANCIAL_LOCK_ENABLED']='true'
 return base
if __name__=='__main__':(ROOT/'wallet-runtime.template.json').write_text(json.dumps(build(),indent=2)+'\n')
