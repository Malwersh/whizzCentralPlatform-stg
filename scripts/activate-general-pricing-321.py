"""One-time user-authorized staging policy migration; never impersonates a staff approval.
Uses the existing pricing schema/current/version/audit store, no order or wallet writes.
All later edits remain in the authenticated central pricing screen.
"""
import pathlib,sys,json,subprocess,datetime,hashlib,uuid
from decimal import Decimal
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
from boto3.dynamodb.types import TypeSerializer
from boto3.dynamodb.conditions import Key
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/general321')
assert json.loads((root/'docs/general-pricing-code-publication-321.json').read_text())['status']=='PUBLISHED_VERIFIED'
assert 'tests 118' in (p/'financial-tests.log').read_text() and 'fail 0' in (p/'financial-tests.log').read_text()
s=session();principal=s.client('sts').get_caller_identity();assert principal['Account']=='699561669180';db=s.resource('dynamodb');staff=db.Table('staging-PlatformStaff');pk='OPERATIONAL_SETTINGS#DELIVERY_PRICING'
def safe_json(v):return int(v)if isinstance(v,Decimal)and v==int(v)else float(v)if isinstance(v,Decimal)else v
def plain(v):return json.loads(json.dumps(v,default=safe_json))
def get(table,key):return db.Table(table).get_item(Key=key,ConsistentRead=True).get('Item')
current=get('staging-PlatformStaff',{'pk':pk,'sk':'CURRENT'});old=plain(current)
# Require the policy audited with the user. Refuse concurrent changes and repeated migration.
assert old['version']==1 and old['values']==json.loads(pathlib.Path('/private/tmp/pricing320/policy.json').read_text())['values'],'Current pricing changed; do not overwrite'
draft=get('staging-PlatformStaff',{'pk':pk,'sk':'DRAFT'});assert not draft or draft.get('publishedVersion'),'An actual open staff change requires review before migration'
areas=json.loads(pathlib.Path('/private/tmp/pricing320/coverage-safe.json').read_text());assert len(areas)==8
for area in areas:
 rid=area['regionId']
 for level in [3,2,1,0]:
  b=get('WizzCentral_Regions',{'regionId':rid});d=get('WizzCentral_RegionsDerived_staging',{'regionId':rid})
  assert b and int(b['level'])==level and b.get('is_active')in [True,1]and d and d.get('effective_is_active')in [True,1],area['regionId']+' inactive hierarchy'
  if level==3:assert b.get('geometry')and db.Table('WizzCentral_RegionIndex_staging').query(IndexName='region-id-index',KeyConditionExpression=Key('regionId').eq(rid),Limit=1).get('Items'),rid+' missing coverage geometry/index'
  rid=b.get('parent_id')
 assert rid in [None,'','ROOT','root']
(p/'policy-before.json').write_text(json.dumps(old,indent=2)+'\n');(p/'areas.json').write_text(json.dumps(areas,indent=2)+'\n')
subprocess.run(['node',str(root/'scripts/build-general-pricing-321.cjs'),str(p/'policy-before.json'),str(p/'areas.json'),str(p/'policy-values.json')],cwd=root,check=True)
values=json.loads((p/'policy-values.json').read_text())['values']
for kind in ['deliveryRules','driverRules']:assert values[kind][:-1]==old['values'][kind]and values[kind][-1]['scope']=={'type':'GLOBAL','id':'GLOBAL'}
now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z');actor=principal['Arn'];operation=str(uuid.uuid4())
next_policy={'pk':pk,'sk':'CURRENT','version':2,'baseVersion':1,'values':values,'requestedBy':actor,'updatedBy':actor,'actorKind':'AWS_DEPLOYMENT_PRINCIPAL','writeMode':'USER_AUTHORIZED_DEPLOYMENT','updatedAt':now,'reason':'تفعيل التسعير العام المعتمد 59 للفروع الحالية والجديدة ضمن مناطق الخدمة الثماني؛ الحفاظ على قواعد الفروع والاتفاقيات والطلبات السابقة','approvalReference':'USER_INSTRUCTION_IMPLEMENT_GENERAL_PRICING_2026_10_23','deploymentId':operation}
archive={**next_policy,'sk':'VERSION#000000000002'}
audit={'pk':'AUDIT','sk':now+'#'+operation,'actorId':actor,'actorKind':'AWS_DEPLOYMENT_PRINCIPAL','action':'PRICING_GENERAL_BASELINE_ACTIVATED','before':old,'after':next_policy,'approvalReference':next_policy['approvalReference']}
serialize=TypeSerializer();encode=lambda item:{k:serialize.serialize(v)for k,v in item.items()}
tx=[{'Put':{'TableName':'staging-PlatformStaff','Item':encode(next_policy),'ConditionExpression':'#v=:v AND #values=:values','ExpressionAttributeNames':{'#v':'version','#values':'values'},'ExpressionAttributeValues':encode({':v':current['version'],':values':current['values']})}}, {'Put':{'TableName':'staging-PlatformStaff','Item':encode(archive),'ConditionExpression':'attribute_not_exists(pk)'}}, {'Put':{'TableName':'staging-PlatformStaff','Item':encode(audit),'ConditionExpression':'attribute_not_exists(sk)'}}]
if draft:tx.append({'ConditionCheck':{'TableName':'staging-PlatformStaff','Key':encode({'pk':pk,'sk':'DRAFT'}),'ConditionExpression':'#v=:v AND publishedVersion=:p','ExpressionAttributeNames':{'#v':'version'},'ExpressionAttributeValues':encode({':v':draft['version'],':p':draft['publishedVersion']})}})
else:tx.append({'ConditionCheck':{'TableName':'staging-PlatformStaff','Key':encode({'pk':pk,'sk':'DRAFT'}),'ConditionExpression':'attribute_not_exists(pk)'}})
s.client('dynamodb').transact_write_items(TransactItems=tx,ClientRequestToken=operation)
actual=plain(get('staging-PlatformStaff',{'pk':pk,'sk':'CURRENT'}));assert actual==next_policy
assert plain(get('staging-PlatformStaff',{'pk':pk,'sk':archive['sk']}))==archive
report={'part':321,'status':'ACTIVE_VERIFIED','environment':'staging','priorPolicyVersion':1,'policyVersion':2,'generalDeliveryRule':'APPROVED_BASELINE_GLOBAL_DELIVERY','generalDriverRule':'APPROVED_BASELINE_GLOBAL_DRIVER','coveredRegions':areas,'existingBranchOverridesUnchanged':True,'pricingSchemaChanged':False,'commercialAgreementsChanged':False,'ordersOrWalletsModified':False,'immutableVersionAndAuditWritten':True,'actorKind':'AWS_DEPLOYMENT_PRINCIPAL','staffApprovalImpersonated':False,'deploymentId':operation,'activatedAt':now,'valuesSha256':hashlib.sha256(json.dumps(values,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'futureBranches':'Automatically use general tariff when eligible and within one of the approved covered regions. No branch-specific rule required.','futureServiceRegions':'Enable/index verified coverage and include the region in the general delivery rule through central pricing; no code change.','rollback':'Do not remove the general driver rule while related offers/orders are in flight. Stop new admissions if needed; publish a new validated policy version retaining compatible driver rules and immutable order evidence.'}
(root/'docs/general-pricing-activation-321.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':report['status'],'policyVersion':2,'coverageRegions':len(areas),'branchOverridesPreserved':True,'financialWrites':0}))
