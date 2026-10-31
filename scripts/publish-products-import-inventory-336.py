"""Scoped staging rollout requested by user. Preserves existing environment/handlers and backs up packages first."""
from pathlib import Path
import boto3,json,zipfile,hashlib,base64,io,time,shutil
R=Path(__file__).resolve().parents[1];O=Path('/private/tmp/products-336-release');s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');iam=s.client('iam');api=s.client('apigateway');ddb=s.client('dynamodb');sqs=s.client('sqs');cw=s.client('cloudwatch')
assert s.client('sts').get_caller_identity()['Account']=='699561669180'
state={'release':336,'stage':'staging','functions':[],'apiRoutes':[],'testEvidence':'docs/products-336-isolated-staging-uat.json'}
assert json.loads((R/'docs/products-336-isolated-staging-uat.json').read_text())['status']=='PASS'
def save():(O/'publication.json').write_text(json.dumps(state,indent=2))
def wait(name):l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':1,'MaxAttempts':90})
configs=json.loads(Path('/private/tmp/products-336-runtime-before.json').read_text())
# Refuse overwriting a function changed after the backup.
for n,c in configs.items():assert l.get_function_configuration(FunctionName=n)['RevisionId']==c['RevisionId'],'LIVE_DRIFT '+n
A='arn:aws:dynamodb:us-east-1:699561669180:table/'
def policy(role,name,statements):
 document=json.dumps({'Version':'2012-10-17','Statement':statements})
 try:iam.put_role_policy(RoleName=role,PolicyName=name,PolicyDocument=document)
 except iam.exceptions.LimitExceededException:
  managed='Products336-'+hashlib.sha256((role+name).encode()).hexdigest()[:12]
  arn='arn:aws:iam::699561669180:policy/'+managed
  try:iam.create_policy(PolicyName=managed,PolicyDocument=document,Description='Scoped staging products and inventory release 336')
  except iam.exceptions.EntityAlreadyExistsException:
   current=iam.get_policy(PolicyArn=arn)['Policy'];saved=iam.get_policy_version(PolicyArn=arn,VersionId=current['DefaultVersionId'])['PolicyVersion']['Document'];assert saved==json.loads(document),'MANAGED_POLICY_DRIFT'
  iam.attach_role_policy(RoleName=role,PolicyArn=arn)
  state.setdefault('managedPolicies',[]).append({'role':role,'arn':arn})
 state.setdefault('iamPolicies',[]).append({'role':role,'policy':name});save()

def allow(actions,resources,condition=None):return {'Effect':'Allow','Action':actions,'Resource':resources,**({'Condition':condition} if condition else {})}
branch={'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['BRANCH#*']}}
for name in configs:
 role=configs[name]['Role'].split('/')[-1]
 if 'product-management' in name:
  policy(role,'ProductsInventory336',[allow(['dynamodb:GetItem','dynamodb:Query','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:ConditionCheckItem'],[A+'staging-MerchantPlatform'],branch),allow(['dynamodb:GetItem','dynamodb:ConditionCheckItem'],[A+'WizzOrders']),allow(['dynamodb:ConditionCheckItem'],[A+'WhizzMerchants_Products']),allow(['dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem'],[A+'WhizzMerchants_Categories'])])
 elif name=='WizzUser-CreateOrder-staging':policy(role,'ProductsInventory336',[allow(['dynamodb:GetItem','dynamodb:ConditionCheckItem','dynamodb:UpdateItem'],[A+'WhizzMerchants_Products']),allow(['dynamodb:GetItem','dynamodb:Query','dynamodb:PutItem','dynamodb:ConditionCheckItem'],[A+'staging-MerchantPlatform'],branch)])
 elif name=='WizzUser-GetBusinessProducts-staging':policy(role,'PublishedMenus336',[allow(['dynamodb:GetItem','dynamodb:Query'],[A+'staging-MerchantPlatform'],branch)])
 elif 'discount-management' in name:policy(role,'PublishedMenus336',[allow(['dynamodb:GetItem','dynamodb:ConditionCheckItem'],[A+'staging-MerchantPlatform'],branch)])
for name in configs:
 if name.startswith('order-receiver-'):
  policy(configs[name]['Role'].split('/')[-1],'MerchantIdentityLookup336',[allow(['cognito-idp:AdminGetUser'],['arn:aws:cognito-idp:us-east-1:699561669180:userpool/us-east-1_gtCR3ndzT'])])
# Inventory listener is live before admitting orders with a stock reservation.
worker='staging-merchant-inventory-336'
try:role=iam.get_role(RoleName=worker)['Role']
except iam.exceptions.NoSuchEntityException:role=iam.create_role(RoleName=worker,AssumeRolePolicyDocument=json.dumps({'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]}),Description='Staging merchant inventory reservation reconciliation')['Role']
queue=sqs.create_queue(QueueName=worker+'-dlq',Attributes={'MessageRetentionPeriod':'1209600','SqsManagedSseEnabled':'true'})['QueueUrl'];qarn=sqs.get_queue_attributes(QueueUrl=queue,AttributeNames=['QueueArn'])['Attributes']['QueueArn'];state['failureQueue']=qarn
policy(worker,'InventoryReconciliation336',[allow(['logs:CreateLogGroup','logs:CreateLogStream','logs:PutLogEvents'],['arn:aws:logs:us-east-1:699561669180:log-group:/aws/lambda/'+worker+':*','arn:aws:logs:us-east-1:699561669180:log-group:/aws/lambda/'+worker]),allow(['dynamodb:GetItem','dynamodb:ConditionCheckItem','dynamodb:UpdateItem'],[A+'WhizzMerchants_Products']),allow(['dynamodb:GetItem','dynamodb:PutItem','dynamodb:ConditionCheckItem'],[A+'staging-MerchantPlatform'],branch),allow(['dynamodb:GetItem','dynamodb:ConditionCheckItem'],[A+'WizzOrders']),allow(['dynamodb:DescribeStream','dynamodb:GetRecords','dynamodb:GetShardIterator','dynamodb:ListStreams'],[A+'WizzOrders/stream/*']),allow(['sqs:SendMessage'],[qarn])])
buf=io.BytesIO()
with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:z.write(O/'candidates/inventory-worker.js','index.js')
try:l.get_function(FunctionName=worker);l.update_function_code(FunctionName=worker,ZipFile=buf.getvalue());wait(worker)
except l.exceptions.ResourceNotFoundException:
 for attempt in range(15):
  try:l.create_function(FunctionName=worker,Runtime='nodejs22.x',Role=role['Arn'],Handler='index.handler',Code={'ZipFile':buf.getvalue()},Timeout=45,MemorySize=256,Environment={'Variables':{'STAGE':'staging'}},Architectures=['x86_64']);break
  except l.exceptions.InvalidParameterValueException:
   if attempt==14:raise
   time.sleep(2)
 l.get_waiter('function_active_v2').wait(FunctionName=worker)
stream=ddb.describe_table(TableName='WizzOrders')['Table']['LatestStreamArn'];mappings=l.list_event_source_mappings(FunctionName=worker,EventSourceArn=stream)['EventSourceMappings']
if not mappings:
 mapping=l.create_event_source_mapping(FunctionName=worker,EventSourceArn=stream,StartingPosition='LATEST',Enabled=True,BatchSize=10,MaximumRetryAttempts=5,BisectBatchOnFunctionError=True,FunctionResponseTypes=['ReportBatchItemFailures'],DestinationConfig={'OnFailure':{'Destination':qarn}},FilterCriteria={'Filters':[{'Pattern':json.dumps({'eventName':['INSERT','MODIFY'],'dynamodb':{'NewImage':{'inventoryReservation':{'M':{'schemaVersion':{'N':['1']}}}}}})}]})
else:mapping=mappings[0]
state['workerMapping']=mapping['UUID'];save()
cw.put_metric_alarm(AlarmName=worker+'-dead-letter',Namespace='AWS/SQS',MetricName='ApproximateNumberOfMessagesVisible',Dimensions=[{'Name':'QueueName','Value':worker+'-dlq'}],Statistic='Maximum',Period=60,EvaluationPeriods=1,Threshold=0,ComparisonOperator='GreaterThanThreshold',TreatMissingData='notBreaching')
# Overlay updated handlers on backed-up packages; dependencies and unrelated deployed modules are preserved.
for name,c in configs.items():
 package=O/name/'package'
 if 'product-management' in name:(package/'product_management_handler.js').write_bytes((O/'candidates/merchant-products.js').read_bytes())
 elif 'image-upload' in name:(package/'image_upload_handler.js').write_bytes((O/'candidates/merchant-images.js').read_bytes())
 elif 'discount-management' in name:(package/'discount_management_handler.js').write_bytes((O/'candidates/merchant-discounts.js').read_bytes())
 elif name=='WizzUser-CreateOrder-staging':
  for directory in ['create-order','get-business-products']:
   dest=package/'functions'/directory;dest.mkdir(parents=True,exist_ok=True)
   for source in (R.parent/'wizzuser-stg/backend/src/functions'/directory).rglob('*.js'):target=dest/source.relative_to(R.parent/'wizzuser-stg/backend/src/functions'/directory);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
 elif name=='WizzUser-GetBusinessProducts-staging':shutil.copy2(R.parent/'wizzuser-stg/backend/src/functions/get-business-products/index.js',package/'functions/get-business-products/index.js')
 candidate=O/name/'candidate.zip'
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as z:
  for p in sorted(package.rglob('*')):
   if p.is_file():z.write(p,str(p.relative_to(package)))
 data=candidate.read_bytes();current=l.get_function_configuration(FunctionName=name);assert current['RevisionId']==c['RevisionId'],'LIVE_DRIFT '+name
 l.update_function_code(FunctionName=name,RevisionId=current['RevisionId'],ZipFile=data);wait(name);after=l.get_function_configuration(FunctionName=name);digest=base64.b64encode(hashlib.sha256(data).digest()).decode();assert after['CodeSha256']==digest
 for k in ['Handler','Role','Runtime']:assert after[k]==c[k]
 state['functions'].append({'name':name,'beforeSha256':c['CodeSha256'],'afterSha256':digest,'handler':after['Handler']});save();print('Published '+name,flush=True)
# Add authenticated routes without replacing any existing API definition.
apiid='ie7z8r4wc0';resources=api.get_resources(restApiId=apiid,limit=500)['items'];by_path={r['path']:r for r in resources};auths=api.get_authorizers(restApiId=apiid,limit=100)['items'];authorizer=next(a for a in auths if a['type']=='COGNITO_USER_POOLS' and a.get('providerARNs')==['arn:aws:cognito-idp:us-east-1:699561669180:userpool/us-east-1_gtCR3ndzT'])
def resource(path):
 if path in by_path:return by_path[path]
 parent,part=path.rsplit('/',1);r=api.create_resource(restApiId=apiid,parentId=resource(parent or '/')['id'],pathPart=part);by_path[path]=r;return r
function='order-receiver-regional-staging-product-management-v4-sam';uri='arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:699561669180:function:'+function+'/invocations'
routes={'/categories':['POST'],'/categories/{categoryId}':['PUT','DELETE'],'/products/imports/preview':['POST'],'/products/imports/{importJobId}':['GET'],'/products/imports/{importJobId}/commit':['POST'],'/menu/versions':['GET'],'/menu/versions/publish':['POST'],'/menu/versions/rollback':['POST'],'/products/inventory':['GET','POST']}
for path,methods in routes.items():
 r=resource(path)
 for method in methods:
  try:old=api.get_method(restApiId=apiid,resourceId=r['id'],httpMethod=method)
  except api.exceptions.NotFoundException:old=None
  if old:
   assert old.get('methodIntegration',{}).get('uri')==uri,'UNEXPECTED_EXISTING_INTEGRATION '+path
   assert old['authorizationType']=='COGNITO_USER_POOLS','UNEXPECTED_EXISTING_AUTH '+path
  else:
   api.put_method(restApiId=apiid,resourceId=r['id'],httpMethod=method,authorizationType='COGNITO_USER_POOLS',authorizerId=authorizer['id'],apiKeyRequired=False)
   api.put_integration(restApiId=apiid,resourceId=r['id'],httpMethod=method,type='AWS_PROXY',integrationHttpMethod='POST',uri=uri)
  state['apiRoutes'].append({'path':path,'method':method,'authorization':'COGNITO_USER_POOLS'});save()
try:l.add_permission(FunctionName=function,StatementId='ProductsImportInventory336',Action='lambda:InvokeFunction',Principal='apigateway.amazonaws.com',SourceArn='arn:aws:execute-api:us-east-1:699561669180:'+apiid+'/*/*/*')
except l.exceptions.ResourceConflictException:pass
previous=api.get_stage(restApiId=apiid,stageName='staging')['deploymentId'];deployment=api.create_deployment(restApiId=apiid,stageName='staging',description='Reviewed product imports, images, inventory and published menus 336');state['apiDeployment']={'apiId':apiid,'previous':previous,'current':deployment['id']};state['complete']=True;save();print(json.dumps(state,indent=2))
