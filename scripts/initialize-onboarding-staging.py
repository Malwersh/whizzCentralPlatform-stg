"""Initialize closed onboarding configuration; existing policies are never overwritten."""
import boto3,json,subprocess,uuid,datetime
from pathlib import Path
from boto3.dynamodb.types import TypeSerializer
root=Path(__file__).resolve().parents[1]
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1')
assert s.client('sts').get_caller_identity()['Account']=='699561669180'
db=s.client('dynamodb');table='staging-PlatformStaff';pk='OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING';serialize=TypeSerializer()
key={'pk':{'S':pk},'sk':{'S':'CURRENT'}}
if db.get_item(TableName=table,Key=key,ConsistentRead=True).get('Item'):
 print(json.dumps({'initialized':False,'existingPolicyPreserved':True}));raise SystemExit()
values=json.loads(subprocess.check_output(['node','-e',"const p=require('./backend/staff-service/onboarding-policy');console.log(JSON.stringify(p.validate(p.DEFAULTS)))"],cwd=root,text=True))
assert all(t['registrationOpen'] is False for t in values['types'])
pid=str(uuid.uuid4());record={'pk':pk,'sk':'CURRENT','version':1,'policyVersion':pid,'values':values,'effectiveFor':'NEW_REQUESTS','initializedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'initializationReason':'Closed Staging configuration; new onboarding not activated'}
items=[]
for sk in ['CURRENT','VERSION#'+pid]:
 item={**record,'sk':sk};items.append({'Put':{'TableName':table,'Item':{k:serialize.serialize(v) for k,v in item.items()},'ConditionExpression':'attribute_not_exists(pk)'}})
db.transact_write_items(TransactItems=items)
print(json.dumps({'initialized':True,'version':1,'registrationOpen':False}))
