"""Explicitly authorized Staging maintenance transfer. No fake staff login or external receipt.
Uses existing wallets, paired TRANSFER ledger entries, idempotency marker, daily limit and audit.
Run without --execute to prepare/review the exact private transaction first.
"""
import pathlib,json,importlib.util,datetime,uuid,sys,decimal
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/driver-funding101');O.mkdir(exist_ok=True);O.chmod(0o700);sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def enc(x):return int(x) if isinstance(x,decimal.Decimal) and x%1==0 else float(x) if isinstance(x,decimal.Decimal) else str(x)
def main():
 completeMinimum='--complete-online-minimum' in sys.argv
 amountRequired=50000
 expectedBefore=10000 if completeMinimum else 0
 planName='online-minimum-funding-plan.private.json' if completeMinimum else 'funding-plan.private.json'
 resultName='online-minimum-funding-result.json' if completeMinimum else 'funding-result.json'
 from boto3.dynamodb.types import TypeSerializer
 s=m.session();actor=s.client('sts').get_caller_identity();assert actor['Account']=='699561669180';db=s.resource('dynamodb');ids=json.loads(pathlib.Path('/private/tmp/finance85/selected-identities.private.json').read_text());driver=ids['profiles']['driver'][0]['driverId'];assert driver=='34d8e408-1021-7076-6055-7325644f97cb';profile=db.Table('WhizzDrivers_staging').get_item(Key={'driverId':driver},ConsistentRead=True)['Item'];phone=''.join(c for c in str(profile.get('phoneNumber') or profile.get('phone') or '') if c.isdigit());assert phone in ['07800868280','9647800868280','7800868280'],'DRIVER_PHONE_MISMATCH';assert not profile.get('isDeleted') and not profile.get('deletedAt') and not profile.get('deletionRequestId');target='WALLET#DRIVER#'+driver;planFile=O/planName
 if not planFile.exists():
  plan={'transferId':str(uuid.uuid4()),'sourceWalletId':'WALLET#PLATFORM','recipientWalletId':target,'amount':amountRequired,'reason':'تمويل تجربة الطلب المالي في Staging بطلب المستخدم؛ ليس إيداعًا نقديًا','authorization':'USER_REQUEST_ADD_50000_TEST_DRIVER_2026_10_17','actorArn':actor['Arn'],'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')};planFile.write_text(json.dumps(plan,ensure_ascii=False,indent=2));planFile.chmod(0o600)
 p=json.loads(planFile.read_text());assert p['recipientWalletId']==target and p['sourceWalletId']=='WALLET#PLATFORM' and p['amount']==amountRequired and p['actorArn']==actor['Arn'];amount=p['amount'];markerKey={'idempotencyKey':'TRANSFER#'+p['transferId'],'sk':'META'};marker=db.Table('staging-IdempotencyKeys').get_item(Key=markerKey,ConsistentRead=True).get('Item')
 if marker:
  assert marker['status']=='COMPLETED' and marker['amount']==amount and marker['recipientWalletId']==target;print(json.dumps({'alreadyCompleted':True,'amountIqd':amount,'noDuplicateCredit':True}));return
 wallets=[db.Table('staging-Wallets').get_item(Key={'walletId':w,'sk':'META'},ConsistentRead=True).get('Item') for w in [p['sourceWalletId'],target]]
 for w in wallets:assert w and w['status']=='ACTIVE' and w['currency']=='IQD' and not w.get('deletionRequestId') and int(w['version'])>=1
 assert wallets[1]['ownerType']=='DRIVER' and wallets[1]['ownerId']==driver and wallets[1]['availableBalance']>=0 and wallets[1]['lockedBalance']>=0,'REVIEW_CHANGED_DRIVER_BALANCE';assert not completeMinimum or wallets[1].get('minRequiredBalance')==25000,'REVIEW_ONLINE_MINIMUM'
 assert wallets[0]['availableBalance']>=amount,'PLATFORM_BALANCE_INSUFFICIENT'
 cfgKey={'idempotencyKey':'CONFIG#TRANSFERS','sk':'META'};cfg=db.Table('staging-IdempotencyKeys').get_item(Key=cfgKey,ConsistentRead=True).get('Item');settings=cfg['config'] if cfg else {'version':0,'enabled':True,'minAmount':1000,'maxAmount':100000,'platformDaily':1000000};assert settings['enabled'] and settings['minAmount']<=amount<=settings['maxAmount'] and amount<=settings['platformDaily']
 public={'prepared':True,'source':'PLATFORM','recipient':'verified test driver 07800868280','amountIqd':amount,'driverBalanceBeforeIqd':int(wallets[1]['availableBalance']),'driverBalanceAfterIqd':int(wallets[1]['availableBalance'])+amount,'pairedLedgerEntries':2,'authenticOperatorAudit':True,'externalDepositClaimed':False}
 if '--execute' not in sys.argv:print(json.dumps(public));return
 ops=[];now=p['createdAt'];date=now[:10];metadata={'sourceWalletId':p['sourceWalletId'],'recipientWalletId':target,'executionMode':'AUTHORIZED_STAGING_MAINTENANCE','authorization':p['authorization']}
 for w,delta in zip(wallets,[-amount,amount]):
  ops.append({'Update':{'TableName':'staging-Wallets','Key':{'walletId':w['walletId'],'sk':'META'},'UpdateExpression':'SET availableBalance=availableBalance+:delta,#v=#v+:one,updatedAt=:now','ConditionExpression':'#s=:active AND currency=:iqd AND #v=:v AND availableBalance=:before AND lockedBalance=:locked AND attribute_not_exists(deletionRequestId)','ExpressionAttributeNames':{'#s':'status','#v':'version'},'ExpressionAttributeValues':{':delta':delta,':one':1,':now':now,':active':'ACTIVE',':iqd':'IQD',':v':w['version'],':before':w['availableBalance'],':locked':w['lockedBalance']}}})
  ops.append({'Put':{'TableName':'staging-LedgerEntries','Item':{'walletId':w['walletId'],'sk':'ts#'+now+'#TRANSFER#'+p['transferId'],'transactionId':p['transferId'],'type':'DEBIT' if delta<0 else 'CREDIT','category':'TRANSFER','amount':delta,'balanceBefore':w['availableBalance'],'balanceAfter':w['availableBalance']+delta,'createdAt':now,'description':p['reason'],'relatedEntityId':p['transferId'],'metadata':metadata},'ConditionExpression':'attribute_not_exists(sk)'}})
 ops.append({'Put':{'TableName':'staging-IdempotencyKeys','Item':{**markerKey,'transferId':p['transferId'],'sourceWalletId':p['sourceWalletId'],'recipientWalletId':target,'amount':amount,'currency':'IQD','reason':p['reason'],'requestedBy':p['actorArn'],'executionMode':'AUTHORIZED_STAGING_MAINTENANCE','authorization':p['authorization'],'settingsVersion':settings['version'],'createdAt':now,'completedAt':now,'status':'COMPLETED'},'ConditionExpression':'attribute_not_exists(idempotencyKey)'}})
 ops.append({'ConditionCheck':{'TableName':'staging-IdempotencyKeys','Key':cfgKey,'ConditionExpression':'config.#v=:v' if cfg else 'attribute_not_exists(idempotencyKey)',**({'ExpressionAttributeNames':{'#v':'version'},'ExpressionAttributeValues':{':v':settings['version']}} if cfg else {})}})
 day=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).date().isoformat();ops.append({'Update':{'TableName':'staging-IdempotencyKeys','Key':{'idempotencyKey':'TRANSFER_DAILY#WALLET#PLATFORM#'+day,'sk':'META'},'UpdateExpression':'SET #t=if_not_exists(#t,:zero)+:amount','ConditionExpression':'attribute_not_exists(#t) OR (#t>=:zero AND #t<=:remaining)','ExpressionAttributeNames':{'#t':'total'},'ExpressionAttributeValues':{':zero':0,':amount':amount,':remaining':settings['platformDaily']-amount}}})
 ops.append({'ConditionCheck':{'TableName':'staging-AccountDeletion','Key':{'pk':'ACCOUNT_LIFECYCLE#DRIVER#'+driver,'sk':'META'},'ConditionExpression':'attribute_not_exists(pk)'}})
 ops.append({'Put':{'TableName':'staging-AuditLog','Item':{'datePartition':'date#'+date.replace('-',''),'sk':now+'#'+p['transferId']+'#STAGING_TEST_FUNDING','action':'STAGING_TEST_FUNDING','actorId':p['actorArn'],'authorization':p['authorization'],'transferId':p['transferId'],'sourceWalletId':p['sourceWalletId'],'recipientWalletId':target,'amount':amount,'reason':p['reason'],'ledgerBalanced':True},'ConditionExpression':'attribute_not_exists(sk)'}})
 ser=TypeSerializer();wire=[]
 for op in ops:
  k,v=next(iter(op.items()));wire.append({k:{name:({a:ser.serialize(b) for a,b in value.items()} if name in ['Item','Key','ExpressionAttributeValues'] else value) for name,value in v.items()}})
 s.client('dynamodb').transact_write_items(TransactItems=wire,ClientRequestToken=p['transferId'])
 after=[db.Table('staging-Wallets').get_item(Key={'walletId':w['walletId'],'sk':'META'},ConsistentRead=True)['Item'] for w in wallets]
 assert after[0]['availableBalance']==wallets[0]['availableBalance']-amount and after[1]['availableBalance']==wallets[1]['availableBalance']+amount and sum(w['availableBalance'] for w in after)==sum(w['availableBalance'] for w in wallets)
 public.update(completed=True,balanceConserved=True,idempotencyProtected=True,driverBalanceAfterIqd=int(after[1]['availableBalance']));(O/resultName).write_text(json.dumps(public,indent=2));print(json.dumps(public))
if __name__=='__main__':main()
