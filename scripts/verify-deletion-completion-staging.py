#!/usr/bin/env python3
"""Real, isolated Staging deletion tests. No real balance or user is altered."""
import boto3, json, uuid, datetime, time
from decimal import Decimal
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1')
assert s.client('sts').get_caller_identity()['Account']=='699561669180'
db=s.resource('dynamodb');lam=s.client('lambda');cog=s.client('cognito-idp')
def invoke(name,payload):
 r=lam.invoke(FunctionName=name,Payload=json.dumps(payload).encode());data=json.loads(r['Payload'].read())
 if r.get('FunctionError'):raise RuntimeError(data.get('errorMessage','Lambda failure'))
 return data
baseline=invoke('staging-account-deletion-financial-expiry',{'dryRun':True})
assert baseline['eligible']==0 and not baseline['incomplete'], 'Unexpected eligible real records; no destructive test allowed'
id=str(uuid.uuid4());wallet='RETENTION_TEST#'+id
key={'walletId':wallet,'sk':'ENTRY#TEST'}
source={**key,'accountDeletionRequestId':id,'financialArchiveConfirmed':True,'financialRetainUntil':int(time.time())-60,'amount':0,'integrationFixture':True}
a={'pk':'REQUEST#'+id,'sk':'LEDGER#'+json.dumps(key,separators=(',',':')),'requestId':id,'kind':'ledger','expiresAt':int(time.time())-60,'sourceTable':'staging-LedgerEntries','sourceKey':key,'legalHold':True,'integrationFixture':True}
ledger=db.Table('staging-LedgerEntries');archive=db.Table('staging-AccountDeletionFinancialArchive')
ledger.put_item(Item=source,ConditionExpression='attribute_not_exists(walletId)');archive.put_item(Item=a,ConditionExpression='attribute_not_exists(pk)')
held=invoke('staging-account-deletion-financial-expiry',{'dryRun':True});assert held['eligible']==0
archive.update_item(Key={'pk':a['pk'],'sk':a['sk']},UpdateExpression='REMOVE legalHold',ConditionExpression='integrationFixture = :yes',ExpressionAttributeValues={':yes':True})
preview=invoke('staging-account-deletion-financial-expiry',{'dryRun':True});assert preview['eligible']==1 and not preview['incomplete']
result=invoke('staging-account-deletion-financial-expiry',{'dryRun':False});assert result['removed']==1 and result['archivesRemoved']==1
assert 'Item' not in ledger.get_item(Key=key,ConsistentRead=True)
assert 'Item' not in archive.get_item(Key={'pk':a['pk'],'sk':a['sk']},ConsistentRead=True)
print(json.dumps({'financialFixture':id,'holdRespected':True,'atomicSourceAndArchiveDeletion':True}))
# Provision a fictitious, non-delivered staff identity. Test only the private worker;
# independent authenticated approval is covered separately by API authorization tests.
username='deletion-test-'+uuid.uuid4().hex+'@example.invalid';pool='us-east-1_wz7vwZZxz'
u=cog.admin_create_user(UserPoolId=pool,Username=username,MessageAction='SUPPRESS',UserAttributes=[{'Name':'email','Value':username},{'Name':'name','Value':'Deletion integration fixture'}])['User']
sub=next(v['Value'] for v in u['Attributes'] if v['Name']=='sub');request=str(uuid.uuid4());staff=db.Table('staging-PlatformStaff')
profile={'pk':'EMPLOYEE#'+sub,'sk':'PROFILE','employeeId':sub,'username':u['Username'],'email':username,'name':'Deletion integration fixture','status':'DELETING','roles':[],'scope':{'allRegions':False,'regionIds':[]},'approvalLimit':0,'version':1,'deletionRequestId':request,'integrationFixture':True}
job={'pk':'STAFF_DELETIONS','sk':request,'requestId':request,'employeeId':sub,'status':'READY','integrationFixture':True}
audit={'pk':'AUDIT','sk':'DELETION_TEST#'+request,'before':profile,'action':'INTEGRATION_FIXTURE','integrationFixture':True}
for row in [profile,audit]:staff.put_item(Item=row,ConditionExpression='attribute_not_exists(pk)')
# Put READY last so the scheduled worker can only see a fully prepared fixture.
staff.put_item(Item=job,ConditionExpression='attribute_not_exists(pk)')
invoke('staging-wizz-staff-deletions',{})
end=staff.get_item(Key={'pk':job['pk'],'sk':job['sk']},ConsistentRead=True)['Item'];assert end['status']=='COMPLETED'
p=staff.get_item(Key={'pk':profile['pk'],'sk':'PROFILE'},ConsistentRead=True)['Item'];assert p['status']=='DELETED' and not any(k in p for k in ['email','username','name'])
snapshot=staff.get_item(Key={'pk':audit['pk'],'sk':audit['sk']},ConsistentRead=True)['Item'];assert not any(k in snapshot['before'] for k in ['email','username','name'])
try:cog.admin_get_user(UserPoolId=pool,Username=u['Username']);raise AssertionError('Identity remains')
except cog.exceptions.UserNotFoundException:pass
print(json.dumps({'staffFixtureRequest':request,'identityDeleted':True,'auditRedacted':True,'tombstoneRetained':True}))
