#!/usr/bin/env python3
"""Exercise a real AWS backup/restore using two fictitious rows in quarantine."""
import boto3,uuid,time,json,subprocess,os,sys,re
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180'
c=s.client('dynamodb');db=s.resource('dynamodb');staff=db.Table('staging-PlatformStaff')
j=staff.get_item(Key={'pk':'STAFF_DELETIONS','sk':'2dfeb33e-2050-4f50-a422-9b9ded2a0c7c'},ConsistentRead=True)['Item'];assert j['status']=='COMPLETED' and j['integrationFixture'] is True
source='staging-DeletionRetentionTest'
if len(sys.argv)>1:
 target=sys.argv[1];assert re.fullmatch(r'RESTORE_QUARANTINE_staging_[a-f0-9]{32}',target)
 b=c.describe_table(TableName=target)['Table']['RestoreSummary']['SourceBackupArn'];assert b.startswith('arn:aws:dynamodb:us-east-1:699561669180:table/'+source+'/backup/')
else:
 source='staging-DeletionRetentionTest';target='RESTORE_QUARANTINE_staging_'+uuid.uuid4().hex
 try:c.describe_table(TableName=source);raise RuntimeError('Existing source fixture table requires review')
 except c.exceptions.ResourceNotFoundException:pass
 c.create_table(TableName=source,BillingMode='PAY_PER_REQUEST',AttributeDefinitions=[{'AttributeName':'id','AttributeType':'S'}],KeySchema=[{'AttributeName':'id','KeyType':'HASH'}],SSESpecification={'Enabled':True},Tags=[{'Key':'Purpose','Value':'account-deletion-integration'}])
 c.get_waiter('table_exists').wait(TableName=source,WaiterConfig={'Delay':10,'MaxAttempts':180})
 t=db.Table(source);t.put_item(Item={'id':'deleted-fixture','employeeId':j['employeeId'],'integrationFixture':True});t.put_item(Item={'id':'active-fixture','employeeId':str(uuid.uuid4()),'integrationFixture':True})
 b=c.create_backup(TableName=source,BackupName='deletion-restore-fixture-'+uuid.uuid4().hex)['BackupDetails']['BackupArn']
 for attempt in range(120):
  if c.describe_backup(BackupArn=b)['BackupDescription']['BackupDetails']['BackupStatus']=='AVAILABLE':break
  time.sleep(2)
 else:raise RuntimeError('Backup readiness timeout')
 c.restore_table_from_backup(TargetTableName=target,BackupArn=b)
c.get_waiter('table_exists').wait(TableName=target,WaiterConfig={'Delay':10,'MaxAttempts':180})
for attempt in range(120):
 if c.describe_table(TableName=target)['Table']['TableStatus']=='ACTIVE':break
 time.sleep(2)
else:raise RuntimeError('Restore readiness timeout')
def gate():
 r=subprocess.run(['node','scripts/verify-restored-data-staging.cjs',target],capture_output=True,text=True,env={**os.environ,'AWS_PROFILE':'Wizz_stg_UserApp'})
 if r.returncode not in [0,2]:raise RuntimeError('Restore gate failed operationally')
 return r.returncode,json.loads(r.stdout)
code,before=gate();assert code==2 and before['blocked']==1, before
# Remove only the resurrected fixture from the isolated restored table.
db.Table(target).delete_item(Key={'id':'deleted-fixture'},ConditionExpression='integrationFixture = :yes',ExpressionAttributeValues={':yes':True})
code,after=gate();assert code==0 and after['passed'] and after['rows']==1, after
report={'backupArn':b,'restoredTable':target,'sourceTable':source,'oldIdentityBlocked':True,'sanitizedCopyPassed':True,'fixtureOnly':True}
open('/private/tmp/wizz-restore-fixture-report.json','w').write(json.dumps(report));print(json.dumps(report))
