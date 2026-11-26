"""One-time Staging initialization explicitly authorized by the project owner.
Future edits use the independent approval API, never this script.
"""
import json,subprocess,datetime,uuid,boto3
from boto3.dynamodb.types import TypeSerializer
v=json.loads(subprocess.check_output(['aws','configure','export-credentials','--profile','Wizz_stg_UserApp','--format','process']))
s=boto3.Session(aws_access_key_id=v['AccessKeyId'],aws_secret_access_key=v['SecretAccessKey'],aws_session_token=v['SessionToken'],region_name='us-east-1')
assert s.client('sts').get_caller_identity()['Account']=='699561669180'
t=s.resource('dynamodb').Table('staging-PlatformStaff')
pk='OPERATIONAL_SETTINGS#ACCOUNT_DELETION'
if t.get_item(Key={'pk':pk,'sk':'CURRENT'},ConsistentRead=True).get('Item'):
 print('Policy already initialized; existing settings preserved.')
 raise SystemExit(0)
people=[];cursor=None
while True:
 r=t.scan(**({'ExclusiveStartKey':cursor} if cursor else {}),FilterExpression='begins_with(pk,:prefix)',ExpressionAttributeValues={':prefix':'EMPLOYEE#'})
 people.extend(x for x in r.get('Items',[]) if x.get('status')=='ACTIVE' and 'bootstrap_admin' in x.get('roles',[]))
 cursor=r.get('LastEvaluatedKey')
 if not cursor:break
assert len(people)==1,'Bootstrap identity is ambiguous'
owner=people[0]
live=s.client('cognito-idp').admin_get_user(UserPoolId='us-east-1_wz7vwZZxz',Username=owner['username'])
assert live['Enabled'] and 'SOFTWARE_TOKEN_MFA' in live.get('UserMFASettingList',[])
version=str(uuid.uuid4());now=datetime.datetime.now(datetime.timezone.utc).isoformat()
record={'pk':pk,'sk':'CURRENT','version':1,'policyVersion':version,'values':{'financialRetentionYears':7,'locationRetentionDays':0,'documentRetentionDays':0,'supportRetentionDays':0},'approvedBy':owner['employeeId'],'requestedBy':owner['employeeId'],'approvedAt':now,'approvalSource':'EXPLICIT_PROJECT_OWNER_INSTRUCTION','effectiveFor':'NEW_REQUESTS','refundMethods':['WALLET_TRANSFER','MANUAL_ZAIN_CASH'],'mandatoryWaitingDays':0}
audit={'pk':'AUDIT','sk':now+'#'+version,'actorId':owner['employeeId'],'action':'DELETION_POLICY_INITIALIZED','after':record}
ser=TypeSerializer();enc=lambda item:{k:ser.serialize(v) for k,v in item.items()}
items=[{'ConditionCheck':{'TableName':t.name,'Key':enc({'pk':owner['pk'],'sk':owner['sk']}),'ConditionExpression':'#v = :v AND #s = :active','ExpressionAttributeNames':{'#v':'version','#s':'status'},'ExpressionAttributeValues':enc({':v':owner['version'],':active':'ACTIVE'})}}]
for row in [record,{**record,'sk':'VERSION#'+version},audit]:items.append({'Put':{'TableName':t.name,'Item':enc(row),'ConditionExpression':'attribute_not_exists(sk)'}})
s.client('dynamodb').transact_write_items(TransactItems=items)
print('Approved Staging policy initialized; seven financial years, immediate eligible personal-data deletion. No accounts deleted.')
