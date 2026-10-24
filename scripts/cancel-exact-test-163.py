"""User-authorized IAM maintenance cancellation of one expired, unfunded COD canary.
No fake merchant/staff identity, financial journal, refund, wallet write or row deletion.
Default read-only; --execute commits a conditional transaction with authentic audit.
"""
import pathlib,json,importlib.util,datetime,uuid,sys
from boto3.dynamodb.types import TypeSerializer
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/financial-device-test-163');O.mkdir(exist_ok=True,mode=0o700)
sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def check(table,key,row,fields=None):
 names={};values={};parts=[]
 for i,k in enumerate(fields or list(row)):
  n='#c'+str(i);names[n]=k
  if k in row:values[':c'+str(i)]=row[k];parts.append(n+'=:c'+str(i))
  else:parts.append('attribute_not_exists('+n+')')
 return {'TableName':table,'Key':key,'ConditionExpression':' AND '.join(parts),'ExpressionAttributeNames':names,**({'ExpressionAttributeValues':values} if values else {})}
def main():
 s=m.session();actor=s.client('sts').get_caller_identity();db=s.resource('dynamodb');selector=json.loads(pathlib.Path('/private/tmp/financial-device-test-161/selector.private.json').read_text());oid=selector['orderId'];key={'PK':'ORDER#'+oid,'SK':'META'}
 order=db.Table('WizzOrders').get_item(Key=key,ConsistentRead=True)['Item'];marker={'idempotencyKey':'MAINTENANCE_CANARY_CANCEL#'+oid,'sk':'META'};prior=db.Table('staging-IdempotencyKeys').get_item(Key=marker,ConsistentRead=True).get('Item')
 if prior:assert prior['status']=='COMPLETED' and order['status']=='cancelled';print(json.dumps({'cancelled':True,'replayed':True,'financialWrites':False}));return
 assert actor['Account']=='699561669180' and order['storeId']==selector['branchId'] and order['status']=='ready_for_pickup' and order['orderStatus']=='ready_for_pickup'
 assert order['paymentMethod']=='cash' and order['paymentStatus']=='pending' and not order.get('paymentIntentId')
 assert all(order.get(k) is None for k in ['financialAcceptance','financialOutcome','holdId','walletPendingHoldId','driverId','assignedDriverId','returnStatus','returnCaseId','cancellationRequestId','cancellationStatus','pickedUpAt','deliveredAt','completedAt'])
 assert order.get('assignmentAttemptCounter',0)==0 and order.get('holdAmount',0)==0 and order.get('holdStatus') in [None,'NONE','NOT_REQUIRED']
 a=order['financialSnapshot']['snapshot']['allocation'];assert a['paymentMethod']=='COD' and a['platformGoodsDiscount']['minorAmount']==0 and a['merchantGoodsDiscount']['minorAmount']==0
 assert order['commercialPricing']['funding']['state']=='NOT_REQUIRED'
 holds=db.Table('staging-Holds').query(KeyConditionExpression='orderId=:o',ExpressionAttributeValues={':o':oid},ConsistentRead=True);assert not holds.get('Items') and not holds.get('LastEvaluatedKey')
 rows={}
 for table in ['WizzDispatchJobs_staging','WaveOffers_staging']:
  result=db.Table(table).query(KeyConditionExpression='orderId=:o',ExpressionAttributeValues={':o':oid},ConsistentRead=True);assert not result.get('LastEvaluatedKey');rows[table]=result['Items']
 jobs=rows['WizzDispatchJobs_staging'];job=next(r for r in jobs if r['SK']=='METADATA');assert job['status']=='no_driver_available' and job['dispatchReview']['reason']=='PREPARATION_DEADLINE' and job['financialDispatch'] is True
 assert all(r.get('state') in ['APPLIED','CANCELLED','PREPARING'] for r in jobs if r['SK']!='METADATA')
 assert all(r.get('responseStatus')=='financial_expired' for r in rows['WaveOffers_staging'])
 pp=O/'cancellation-plan.private.json'
 if not pp.exists():pp.write_text(json.dumps({'requestId':str(uuid.uuid4()),'at':datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'),'actorArn':actor['Arn'],'orderId':oid}));pp.chmod(0o600)
 p=json.loads(pp.read_text());assert p['actorArn']==actor['Arn'] and p['orderId']==oid;at=p['at'];reason='إلغاء الطلب التجريبي بطلب المستخدم لإعادة اختبار الموجات'
 fields=['status','orderStatus','rev','storeStatus','storeId','userSub','financialSnapshot','commercialPricing','financialSearch','deliveryJobId','paymentMethod','paymentStatus','paymentIntentId','financialAcceptance','financialOutcome','holdId','holdAmount','holdStatus','walletPendingHoldId','driverId','assignedDriverId','assignmentAttemptCounter','returnStatus','returnCaseId','cancellationRequestId','cancellationStatus','pickedUpAt','deliveredAt','completedAt','deletionRequestId','deletedAt','isDeleted']
 c=check('WizzOrders',key,order,fields);c['UpdateExpression']='SET #s=:s,#os=:s,canceledAt=:at,canceledBy=:actor,cancelReason=:reason,updatedAt=:at,rev=:rev,storeStatus=:storeStatus,maintenanceCancellation=:receipt';c['ExpressionAttributeNames'].update({'#s':'status','#os':'orderStatus'});receipt={'kind':'AUTHORIZED_STAGING_TEST_CANCELLATION','operationId':p['requestId'],'actorArn':actor['Arn'],'at':at,'reason':reason,'noAssignmentOrFunds':True};c['ExpressionAttributeValues'].update({':s':'cancelled',':at':at,':actor':actor['Arn'],':reason':reason,':rev':order['rev']+1,':storeStatus':order['storeId']+'#cancelled#'+order['storeStatus'].split('#')[-1],':receipt':receipt});ops=[{'Update':c}]
 for row in jobs:
  c=check('WizzDispatchJobs_staging',{'orderId':oid,'SK':row['SK']},row)
  if row['SK']=='METADATA':
   c['UpdateExpression']='SET #s=:s,updatedAt=:at,cancelReason=:reason,maintenanceCancellationId=:op';c['ExpressionAttributeNames']['#s']='status';c.setdefault('ExpressionAttributeValues',{}).update({':s':'cancelled',':at':at,':reason':reason,':op':p['requestId']});ops.append({'Update':c})
  elif row.get('state')=='PREPARING':
   assert row.get('kind')=='FINANCIAL_WAVE' and not row.get('delivered') and not rows['WaveOffers_staging'];c['UpdateExpression']='SET #closedState=:closedState,maintenanceCancellationId=:closedOp';c['ExpressionAttributeNames']['#closedState']='state';c.setdefault('ExpressionAttributeValues',{}).update({':closedState':'CANCELLED',':closedOp':p['requestId']});ops.append({'Update':c})
  else:ops.append({'ConditionCheck':c})
 for row in rows['WaveOffers_staging']:ops.append({'ConditionCheck':check('WaveOffers_staging',{'orderId':oid,'SK':row['SK']},row)})
 for sk in ['HOLD','PROMOTION_FUNDING','DELIVERY_PROMOTION_FUNDING','FINANCIAL_OUTCOME']:ops.append({'ConditionCheck':{'TableName':'staging-Holds','Key':{'orderId':oid,'sk':sk},'ConditionExpression':'attribute_not_exists(orderId)'}})
 ops.append({'Put':{'TableName':'staging-IdempotencyKeys','Item':{**marker,**receipt,'orderId':oid,'status':'COMPLETED'},'ConditionExpression':'attribute_not_exists(idempotencyKey)'}})
 ops.append({'Put':{'TableName':'staging-AuditLog','Item':{'datePartition':'date#'+at[:10].replace('-',''),'sk':at+'#'+p['requestId']+'#STAGING_CANARY_CANCEL','action':'AUTHORIZED_STAGING_CANARY_CANCEL','actorId':actor['Arn'],'orderId':oid,'reason':reason,'authorization':'EXPLICIT_USER_CANCEL_CURRENT_CANARY','requestId':p['requestId'],'createdAt':at,'walletChanged':False,'financialJournalFabricated':False},'ConditionExpression':'attribute_not_exists(sk)'}})
 print(json.dumps({'prepared':True,'transactionOperations':len(ops),'deletes':0,'walletWrites':0,'ledgerWrites':0,'authenticOperatorAudit':True}),flush=True)
 if '--execute' not in sys.argv:return
 ser=TypeSerializer();wire=[]
 for op in ops:
  k,v=next(iter(op.items()));wire.append({k:{n:({a:ser.serialize(b) for a,b in x.items()} if n in ['Key','Item','ExpressionAttributeValues'] else x) for n,x in v.items()}})
 s.client('dynamodb').transact_write_items(TransactItems=wire,ClientRequestToken=p['requestId'])
 after=db.Table('WizzOrders').get_item(Key=key,ConsistentRead=True)['Item'];assert after['status']=='cancelled' and after['orderStatus']=='cancelled' and after['maintenanceCancellation']['operationId']==p['requestId'] and after['financialSnapshot']==order['financialSnapshot']
 result={'cancelled':True,'canonicalOrderPreserved':True,'dispatchCancelled':True,'walletWrites':0,'ledgerWrites':0,'operatorAuditRecorded':True};(O/'cancellation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
