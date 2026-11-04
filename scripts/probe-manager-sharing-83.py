"""Read-only live-role verification; never submits human consent or sends notifications."""
import pathlib,json,importlib.util,zipfile,io,copy,time
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/sharing83');sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 s=m.session();l=s.client('lambda');table=s.resource('dynamodb').Table('staging-MerchantPlatform');member=None;cursor=None
 for _ in range(30):
  args={'FilterExpression':'#r=:r AND #s=:s','ExpressionAttributeNames':{'#r':'role','#s':'status'},'ExpressionAttributeValues':{':r':'MANAGER',':s':'ACTIVE'},'ProjectionExpression':'pk,sk,subjectId,businessId,ownerId,permissionSchema'}
  if cursor:args['ExclusiveStartKey']=cursor
  rows=table.scan(**args)
  member=next((x for x in rows.get('Items',[]) if x.get('pk','').startswith('BRANCH#') and x.get('sk')=='MEMBER#'+x.get('subjectId','') and x.get('businessId') and x.get('ownerId')),None)
  if member:break
  cursor=rows.get('LastEvaluatedKey')
  if not cursor:break
 assert member,'NO_ASSIGNED_MANAGER_FOR_READ_PROBE'
 event={'businessId':member['businessId'],'subjectId':member['subjectId']};checks={}
 codes={
 'staff':"const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');const {DynamoDBDocumentClient,GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');exports.handler=async e=>{const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));const b=(await db.send(new GetCommand({TableName:'WhizzMerchants_Businesses',Key:{businessId:e.businessId},ConsistentRead:true}))).Item;const p=await require('./commercial-party').resolve(db,b,e.subjectId);await db.send(new TransactWriteCommand({TransactItems:p.guards}));return {role:p.role,readOnlyGuardsPassed:true};};",
 'push':"const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');const {DynamoDBDocumentClient,QueryCommand,GetCommand}=require('@aws-sdk/lib-dynamodb');exports.handler=async e=>{const db=DynamoDBDocumentClient.from(new DynamoDBClient({}));const fields=require('./src/utils/commercial-sharing-push').fields;const r=await db.send(new QueryCommand({TableName:'staging-MerchantPlatform',KeyConditionExpression:'pk=:pk AND begins_with(sk,:p)',ExpressionAttributeValues:{':pk':'BRANCH#'+e.businessId,':p':'MEMBER#'},ProjectionExpression:fields.map((_,i)=>'#f'+i).join(','),ExpressionAttributeNames:Object.fromEntries(fields.map((f,i)=>['#f'+i,f])),ConsistentRead:true,Limit:100}));await db.send(new GetCommand({TableName:'staging-PlatformStaff',Key:{pk:'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',sk:'CURRENT'},ProjectionExpression:'#v,enabledPermissions',ExpressionAttributeNames:{'#v':'version'}}));return {assignedManagerFound:(r.Items||[]).some(x=>x.subjectId===e.subjectId&&x.role==='MANAGER'),scopedReadsPassed:true,notificationsSent:0};};"}
 for key,code in codes.items():
  cfg=json.loads((O/(key+'.config.private.json')).read_text());name='staging-manager-read-probe83-'+key+'-'+str(int(time.time()));payload=io.BytesIO();created=False
  with zipfile.ZipFile(O/(key+'.candidate.zip')) as old,zipfile.ZipFile(payload,'w',zipfile.ZIP_DEFLATED) as out:
   for item in old.infolist():out.writestr(copy.copy(item),old.read(item.filename))
   out.writestr('probe83.js',code)
  try:
   l.create_function(FunctionName=name,Runtime=cfg['Runtime'],Role=cfg['Role'],Handler='probe83.handler',Code={'ZipFile':payload.getvalue()},MemorySize=cfg['MemorySize'],Timeout=30,Environment=cfg['Environment']);created=True;l.get_waiter('function_active_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':60});r=l.invoke(FunctionName=name,Payload=json.dumps(event).encode());body=json.loads(r['Payload'].read());assert not r.get('FunctionError'),body;checks[key]=body
  finally:
   if created:l.delete_function(FunctionName=name)
   try:s.client('logs').delete_log_group(logGroupName='/aws/lambda/'+name)
   except s.client('logs').exceptions.ResourceNotFoundException:pass
 assert checks['staff']['role']=='MANAGER' and checks['push']['assignedManagerFound'];checks['temporaryProbesRemoved']=True;(O/'runtime-probe.json').write_text(json.dumps(checks,indent=2));print(json.dumps(checks))
if __name__=='__main__':main()
