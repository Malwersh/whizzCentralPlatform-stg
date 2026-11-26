"""Queue missing notifications for existing pending requests; never consent/publish or change terms."""
import pathlib,json,importlib.util,datetime
from boto3.dynamodb.types import TypeSerializer
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/sharing78');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 s=m.session();r=s.resource('dynamodb');d=s.client('dynamodb');serialize=TypeSerializer();conv=lambda row:{k:serialize.serialize(v) for k,v in row.items()};S='staging-PlatformStaff';P='staging-MerchantPlatform';B='WhizzMerchants_Businesses';L='staging-AccountDeletion';table=r.Table(S);rows=[];cursor=None
 for page in range(30):
  q=table.scan(FilterExpression='begins_with(pk,:prefix) AND sk=:draft',ExpressionAttributeValues={':prefix':'DISCOUNT_FUNDING#',':draft':'DRAFT'},ConsistentRead=True,Limit=100,**({'ExclusiveStartKey':cursor} if cursor else {}));rows.extend(q.get('Items',[]));cursor=q.get('LastEvaluatedKey')
  if not cursor:break
 assert not cursor,'INCOMPLETE_DRAFT_INVENTORY'
 get=lambda t,key:r.Table(t).get_item(Key=key,ConsistentRead=True).get('Item');queued=[];skipped=0;now=datetime.datetime.now(datetime.timezone.utc)
 for row in rows:
  if row.get('kind')!='FUNDING' or row.get('publishedVersion') or len(row.get('businessIds',[]))!=1:skipped+=1;continue
  pk=row['pk'];version=int(row['version']);branchId=row['businessIds'][0];owner=row['ownerId'];noticeKey={'pk':pk,'sk':'NOTICE#'+str(version)}
  try:expired=datetime.datetime.fromisoformat(row['values']['effectiveTo'].replace('Z','+00:00'))<=now
  except (ValueError,KeyError):expired=True
  if expired or get(S,noticeKey) or get(S,{'pk':pk,'sk':'CONSENT#'+str(version)}):skipped+=1;continue
  b=get(B,{'businessId':branchId});v=row['values'];c=get('WhizzMerchants_Discounts' if v['source']=='MERCHANT' else 'WizzCentral_Platform_Discounts',{'discountId':v['campaignId']})
  if not b or b.get('ownerId')!=owner or b.get('cognitoUserId')!=owner or b.get('deletionRequestId') or b.get('isDeleted') or not c or c.get('version')!=v['campaignVersion']:skipped+=1;continue
  life=[{'pk':'ACCOUNT_LIFECYCLE#MERCHANT#'+owner,'sk':'META'},{'pk':'BUSINESS_LIFECYCLE#MERCHANT#'+branchId,'sk':'META'}]
  if any(get(L,key) for key in life):skipped+=1;continue
  item={**noticeKey,'ownerId':owner,'businessId':branchId,'draftVersion':version,'draftHash':row['hash'],'eventId':'sharing:'+row['id']+':'+str(version),'status':'PENDING','createdAt':row['createdAt'],'expiresAt':v['effectiveTo'],'attempts':0,'nextAttemptAt':0,'leaseUntil':0,'sentTokenHashes':[]}
  tx=[{'ConditionCheck':{'TableName':S,'Key':conv({'pk':pk,'sk':'DRAFT'}),'ConditionExpression':'#v=:v AND #h=:h AND attribute_not_exists(publishedVersion)','ExpressionAttributeNames':{'#v':'version','#h':'hash'},'ExpressionAttributeValues':conv({':v':version,':h':row['hash']})}},{'ConditionCheck':{'TableName':B,'Key':conv({'businessId':branchId}),'ConditionExpression':'ownerId=:o AND cognitoUserId=:o AND attribute_not_exists(deletionRequestId)','ExpressionAttributeValues':conv({':o':owner})}},{'ConditionCheck':{'TableName':S,'Key':conv({'pk':pk,'sk':'CONSENT#'+str(version)}),'ConditionExpression':'attribute_not_exists(pk)'}},*[{'ConditionCheck':{'TableName':L,'Key':conv(key),'ConditionExpression':'attribute_not_exists(pk)'}} for key in life],{'Put':{'TableName':S,'Item':conv(item),'ConditionExpression':'attribute_not_exists(pk)'}}]
  tx.append({'ConditionCheck':{'TableName':'WhizzMerchants_Discounts' if v['source']=='MERCHANT' else 'WizzCentral_Platform_Discounts','Key':conv({'discountId':v['campaignId']}),'ConditionExpression':'#v=:v','ExpressionAttributeNames':{'#v':'version'},'ExpressionAttributeValues':conv({':v':v['campaignVersion']})}})
  d.transact_write_items(TransactItems=tx);queued.append(noticeKey)
 result={'queuedCount':len(queued),'skippedCount':skipped,'noticeKeys':queued,'financialTermsChanged':False,'ownerConsentSubmitted':False};(O/'backfill.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='noticeKeys'}))
if __name__=='__main__':main()
