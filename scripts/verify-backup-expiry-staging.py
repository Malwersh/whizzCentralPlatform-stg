#!/usr/bin/env python3
"""Expire only the previously restored, fictitious integration backup."""
import boto3,json,time
report=json.load(open('/private/tmp/wizz-restore-fixture-report.json'));assert report['fixtureOnly'] and report['sanitizedCopyPassed'] and report['oldIdentityBlocked']
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180'
c=s.client('dynamodb');db=s.resource('dynamodb');lam=s.client('lambda');arn=report['backupArn'];assert arn.startswith('arn:aws:dynamodb:us-east-1:699561669180:table/staging-DeletionRetentionTest/backup/')
def backups():
 rows=[]
 for p in c.get_paginator('list_backups').paginate(BackupType='USER'):rows.extend(p.get('BackupSummaries',[]))
 return {r['BackupArn'] for r in rows}
original=backups()-{arn}
def invoke(dry):
 r=lam.invoke(FunctionName='staging-account-deletion-backup-retention',Payload=json.dumps({'dryRun':dry}).encode());body=json.loads(r['Payload'].read())
 if r.get('FunctionError'):raise RuntimeError(body.get('errorMessage','Lambda failure'))
 return body
before=invoke(True);assert before['removed']==0
invoke(False)
t=db.Table('staging-AccountDeletion');key={'pk':'BACKUP_RETENTION','sk':arn}
t.update_item(Key=key,UpdateExpression='SET retainUntil = :past, legalHold = :yes, integrationFixture = :yes',ConditionExpression='#s = :retained AND tableName = :table',ExpressionAttributeNames={'#s':'status'},ExpressionAttributeValues={':past':int(time.time())-1,':yes':True,':retained':'RETAINED',':table':'staging-DeletionRetentionTest'})
held=invoke(False);assert held['removed']==0;c.describe_backup(BackupArn=arn)
t.update_item(Key=key,UpdateExpression='REMOVE legalHold',ConditionExpression='integrationFixture = :yes AND #s = :retained',ExpressionAttributeNames={'#s':'status'},ExpressionAttributeValues={':yes':True,':retained':'RETAINED'})
preview=invoke(True);assert preview['removed']==1
expired=invoke(False);assert expired['removed']==1
for _ in range(120):
 try:c.describe_backup(BackupArn=arn)
 except c.exceptions.BackupNotFoundException:break
 time.sleep(2)
else:raise RuntimeError('Physical backup deletion not confirmed')
assert original.issubset(backups()),'Original backups changed unexpectedly'
for table in [report['restoredTable'],report['sourceTable']]:
 assert table=='staging-DeletionRetentionTest' or table.startswith('RESTORE_QUARANTINE_staging_')
 c.delete_table(TableName=table)
print(json.dumps({'fixtureBackupDeleted':True,'holdRespected':True,'originalBackupsPreserved':len(original),'testTablesCleanupStarted':True}))
