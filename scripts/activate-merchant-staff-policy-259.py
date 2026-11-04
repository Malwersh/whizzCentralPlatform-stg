"""Activate the reviewed implemented job templates; never update employee memberships."""
import pathlib,sys,json,datetime,hashlib,uuid
from boto3.dynamodb.types import TypeSerializer
from boto3.dynamodb.conditions import Key
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/registry-259');s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');pub=json.loads((r/'docs/merchant-staff-settlements-publication-259.json').read_text());assert pub['status']=='PUBLISHED_POLICY_PENDING' and pub['hosting']['status']=='SUCCEED';assert len(pub['functions'])==9
for f in pub['functions']:assert l.get_function_configuration(FunctionName=f['function'])['CodeSha256']==f['deployedCodeSha256']
d=s.resource('dynamodb');table=d.Table('staging-PlatformStaff');mp=d.Table('staging-MerchantPlatform');before=json.loads((p/'policy-before.json').read_text());values=json.loads((p/'policy-next.json').read_text());key={'pk':'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS','sk':'CURRENT'};actual=table.get_item(Key=key,ConsistentRead=True)['Item'];assert actual==before,'POLICY_DRIFT';adminId='f40834f8-4091-7054-0e20-dba35a2793ce';admin=table.get_item(Key={'pk':'EMPLOYEE#'+adminId,'sk':'PROFILE'},ConsistentRead=True)['Item'];assert admin['status']=='ACTIVE' and 'bootstrap_admin' in admin['roles'] and admin['scope']['allRegions'] is True
branch='business_95ac73c9-feda-4207-9285-550aec61b94c'
def members():
 rows=[];cursor=None
 while True:
  q=mp.query(KeyConditionExpression=Key('pk').eq('BRANCH#'+branch)&Key('sk').begins_with('MEMBER#'),ConsistentRead=True,**({'ExclusiveStartKey':cursor}if cursor else {}));rows+=q['Items'];cursor=q.get('LastEvaluatedKey')
  if not cursor:return rows
membersBefore=members();at=datetime.datetime.now(datetime.timezone.utc).isoformat();actor='SYSTEM_RELEASE_259';reason='إكمال صلاحيات قراءة التسويات وطلب الصرف وتأكيد الاستلام للمدير والموظف المالي؛ التعيينات الفردية تبقى صريحة من المالك.';row={**before,**values,**key,'updatedAt':at,'updatedBy':actor,'reason':reason};audit={'pk':'AUDIT','sk':at+'#MERCHANT_STAFF_POLICY_259','actorId':actor,'action':'MERCHANT_STAFF_POLICY_SAVED','authorizationBasis':'USER_REQUESTED_IMPLEMENTATION','before':{'version':before['version'],'roles':before['roles'],'enabledPermissions':before['enabledPermissions']},'after':{'version':row['version'],'roles':row['roles'],'enabledPermissions':row['enabledPermissions']},'reason':reason,'employeeMembershipsChanged':False}
ops=[{'ConditionCheck':{'TableName':table.name,'Key':{'pk':'EMPLOYEE#'+adminId,'sk':'PROFILE'},'ConditionExpression':'#v=:v AND #s=:s','ExpressionAttributeNames':{'#v':'version','#s':'status'},'ExpressionAttributeValues':{':v':admin['version'],':s':'ACTIVE'}}},{'Put':{'TableName':table.name,'Item':row,'ConditionExpression':'#v=:v','ExpressionAttributeNames':{'#v':'version'},'ExpressionAttributeValues':{':v':before['version']}}},{'Put':{'TableName':table.name,'Item':{**row,'sk':'VERSION#'+str(row['version']).zfill(12)},'ConditionExpression':'attribute_not_exists(pk)'}},{'Put':{'TableName':table.name,'Item':audit,'ConditionExpression':'attribute_not_exists(pk)'}}]
ser=TypeSerializer()
for op in ops:
 v=next(iter(op.values()))
 for field in ['Key','Item','ExpressionAttributeValues']:
  if field in v:v[field]={k:ser.serialize(x)for k,x in v[field].items()}
s.client('dynamodb').transact_write_items(TransactItems=ops,ClientRequestToken='merchant-staff-policy-259-v2');assert table.get_item(Key=key,ConsistentRead=True)['Item']==row;assert members()==membersBefore,'MEMBERSHIP_CONCURRENT_CHANGE'
record={'part':259,'status':'ACTIVE','version':row['version'],'previousVersion':before['version'],'updatedAt':at,'updatedBy':actor,'addedPermissions':sorted(set(values['enabledPermissions'])-set(before['enabledPermissions'])),'roles':[{'id':v['id'],'version':v['version'],'enabled':v['enabled']}for v in values['roles']],'scope':'staging','explicitOwnerGrantStillRequired':True,'currentBranchMembershipsUnchanged':True,'financialWrites':False,'iamChanged':False};(r/'docs/merchant-staff-settlements-policy-259.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');pub['status']='PUBLISHED';pub['policyVersion']=row['version'];(r/'docs/merchant-staff-settlements-publication-259.json').write_text(json.dumps(pub,ensure_ascii=False,indent=2)+'\n');print(json.dumps(record,ensure_ascii=False))
