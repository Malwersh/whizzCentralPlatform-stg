"""Explicit user-authorized virtual Staging credit, not cash or a platform transfer.
Append-only evidence, clearing journal, CAS and idempotency; one fixed test driver.
"""
from pathlib import Path
import importlib.util,json,uuid,datetime,sys
R=Path(__file__).resolve().parents[1];O=Path('/private/tmp/driver-funding102');O.mkdir(exist_ok=True);O.chmod(0o700)
sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 s=m.session();actor=s.client('sts').get_caller_identity();assert actor['Account']=='699561669180'
 db=s.resource('dynamodb');driver='34d8e408-1021-7076-6055-7325644f97cb';walletId='WALLET#DRIVER#'+driver;amount=50000
 profile=db.Table('WhizzDrivers_staging').get_item(Key={'driverId':driver},ConsistentRead=True)['Item'];phoneField=next(k for k in ['phoneNumber','phone'] if profile.get(k));phone=''.join(c for c in str(profile[phoneField]) if c.isdigit());assert phone in ['07800868280','9647800868280','7800868280'];assert not any(profile.get(k) for k in ['isDeleted','deletedAt','deletionRequestId'])
 planPath=O/'plan.private.json'
 if not planPath.exists():
  planPath.write_text(json.dumps({'fundingId':str(uuid.uuid4()),'walletId':walletId,'amount':amount,'environment':'staging','kind':'VIRTUAL_TEST_CREDIT','actorArn':actor['Arn'],'authorization':'USER_EXPLICIT_DIRECT_VIRTUAL_DRIVER_CREDIT_2026_10_17','reason':'رصيد اختبار افتراضي بطلب المستخدم؛ لا يمثل إيداعًا نقديًا أو تحويلًا من المنصة'},ensure_ascii=False,indent=2));planPath.chmod(0o600)
 p=json.loads(planPath.read_text());assert p['walletId']==walletId and p['amount']==amount and p['actorArn']==actor['Arn'] and p['environment']=='staging'
 markerKey={'idempotencyKey':'VIRTUAL_TEST_CREDIT#'+p['fundingId'],'sk':'META'}
 marker=db.Table('staging-IdempotencyKeys').get_item(Key=markerKey,ConsistentRead=True).get('Item')
 wallet=db.Table('staging-Wallets').get_item(Key={'walletId':walletId,'sk':'META'},ConsistentRead=True)['Item']
 if marker:
  assert marker['status']=='COMPLETED' and marker['amount']==amount and marker['walletId']==walletId
  print(json.dumps({'alreadyCredited':True,'addedIqd':amount,'availableIqd':int(wallet['availableBalance'])}));return
 assert wallet['ownerType']=='DRIVER' and wallet['ownerId']==driver and wallet['status']=='ACTIVE' and wallet['currency']=='IQD' and not wallet.get('deletionRequestId')
 before=int(wallet['availableBalance']);locked=int(wallet['lockedBalance']);assert before>=0 and locked>=0 and int(wallet['version'])>=1
 now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z');funding=p['fundingId'];after=before+amount
 entry={'walletId':walletId,'sk':'ts#'+now+'#VIRTUAL_TEST_CREDIT#'+funding,'transactionId':funding,'type':'TOPUP','category':'TOPUP','amount':amount,'balanceBefore':before,'balanceAfter':after,'balance':after,'relatedEntityType':'TOPUP','relatedEntityId':funding,'description':p['reason'],'createdAt':now,'timestamp':now,'metadata':{'isTestFunding':True,'environment':'staging','source':'NON_CASH_TEST_CLEARING','executionMode':'AUTHORIZED_STAGING_MAINTENANCE','authorization':p['authorization'],'fundingId':funding,'externalDepositClaimed':False}}
 journal={**markerKey,'sk':'JOURNAL','fundingId':funding,'environment':'staging','isTestFunding':True,'currency':'IQD','createdAt':now,'legs':[{'account':walletId,'amount':amount},{'account':'NON_CASH_TEST_CLEARING','amount':-amount}],'sum':0};assert sum(v['amount'] for v in journal['legs'])==0
 ops=[{'Update':{'TableName':'staging-Wallets','Key':{'walletId':walletId,'sk':'META'},'UpdateExpression':'SET availableBalance=availableBalance+:a,#v=#v+:one,updatedAt=:now','ConditionExpression':'#v=:v AND #s=:active AND ownerId=:owner AND currency=:iqd AND availableBalance=:before AND lockedBalance=:locked AND attribute_not_exists(deletionRequestId)','ExpressionAttributeNames':{'#v':'version','#s':'status'},'ExpressionAttributeValues':{':a':amount,':one':1,':now':now,':v':wallet['version'],':active':'ACTIVE',':owner':driver,':iqd':'IQD',':before':before,':locked':locked}}},
 {'Put':{'TableName':'staging-LedgerEntries','Item':entry,'ConditionExpression':'attribute_not_exists(sk)'}},
 {'Put':{'TableName':'staging-IdempotencyKeys','Item':{**markerKey,**p,'status':'COMPLETED','completedAt':now,'balanceBefore':before,'balanceAfter':after,'lockedBalanceUnchanged':locked,'externalDepositClaimed':False},'ConditionExpression':'attribute_not_exists(idempotencyKey)'}},
 {'Put':{'TableName':'staging-IdempotencyKeys','Item':journal,'ConditionExpression':'attribute_not_exists(sk)'}},
 {'ConditionCheck':{'TableName':'staging-AccountDeletion','Key':{'pk':'ACCOUNT_LIFECYCLE#DRIVER#'+driver,'sk':'META'},'ConditionExpression':'attribute_not_exists(pk)'}},
 {'ConditionCheck':{'TableName':'WhizzDrivers_staging','Key':{'driverId':driver},'ConditionExpression':'#p=:p AND attribute_not_exists(deletionRequestId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(isDeleted) OR isDeleted=:false)','ExpressionAttributeNames':{'#p':phoneField},'ExpressionAttributeValues':{':p':profile[phoneField],':false':False}}},
 {'Put':{'TableName':'staging-AuditLog','Item':{'datePartition':'date#'+now[:10].replace('-',''),'sk':now+'#'+funding+'#VIRTUAL_TEST_CREDIT','action':'VIRTUAL_TEST_CREDIT','actorId':actor['Arn'],'authorization':p['authorization'],'fundingId':funding,'walletId':walletId,'amount':amount,'isTestFunding':True,'externalDepositClaimed':False,'reason':p['reason']},'ConditionExpression':'attribute_not_exists(sk)'}}]
 public={'prepared':True,'addedIqd':amount,'beforeIqd':before,'afterIqd':after,'lockedIqd':locked,'virtualTestFunds':True,'platformWalletTouched':False}
 if '--execute' not in sys.argv:print(json.dumps(public));return
 from boto3.dynamodb.types import TypeSerializer
 ser=TypeSerializer();wire=[]
 for op in ops:
  kind,values=next(iter(op.items()));wire.append({kind:{k:({a:ser.serialize(b) for a,b in v.items()} if k in ['Item','Key','ExpressionAttributeValues'] else v) for k,v in values.items()}})
 s.client('dynamodb').transact_write_items(TransactItems=wire,ClientRequestToken=funding)
 actual=db.Table('staging-Wallets').get_item(Key={'walletId':walletId,'sk':'META'},ConsistentRead=True)['Item'];assert actual['availableBalance']==after and actual['lockedBalance']==locked and actual['version']==wallet['version']+1
 ledger=db.Table('staging-LedgerEntries').get_item(Key={'walletId':walletId,'sk':entry['sk']},ConsistentRead=True)['Item'];assert ledger['amount']==amount and ledger['metadata']['isTestFunding'] is True
 public.update(completed=True,ledgerVerified=True,idempotencyProtected=True);(O/'result.json').write_text(json.dumps(public,indent=2));print(json.dumps(public))
if __name__=='__main__':main()
