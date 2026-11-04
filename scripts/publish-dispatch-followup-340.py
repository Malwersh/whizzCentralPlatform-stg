from pathlib import Path
import base64,datetime,hashlib,json,time
import boto3
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/dispatch-followup-340');S=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');L=S.client('lambda');I=S.client('iam');DB=S.resource('dynamodb');D=S.client('dynamodb')
assert S.client('sts').get_caller_identity()['Account']=='699561669180'
review=json.loads((P/'candidate-review.json').read_text());receipt={'part':340,'scope':'staging','status':'PREPARING','functions':[],'financialModulesPreserved':True,'newFinancialActions':False}
def save(): (R/'docs/dispatch-followup-publication-340.json').write_text(json.dumps(receipt,indent=2)+'\n')
def wait(name):
 for _ in range(90):
  c=L.get_function_configuration(FunctionName=name)
  if c.get('LastUpdateStatus')=='Successful':return c
  assert c.get('LastUpdateStatus')!='Failed',c.get('LastUpdateStatusReason')
  time.sleep(2)
 raise RuntimeError('Lambda update timeout')
for row in review['functions']:
 cfg=L.get_function_configuration(FunctionName=row['name']);assert cfg['CodeSha256']==row['baseCodeSha256'],'LIVE_CODE_DRIFT '+row['name'];assert hashlib.sha256((P/(row['tag']+'-candidate.zip')).read_bytes()).hexdigest()==row['candidateSHA256']
base='arn:aws:dynamodb:us-east-1:699561669180:table/';role=json.loads((P/'integration-config.private.json').read_text())['Role'].split('/')[-1]
policy={'Version':'2012-10-17','Statement':[
 {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':base+'staging-PlatformStaff','Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['OPERATIONAL_SETTINGS#DISPATCH_FOLLOWUP','CONTROL#DISPATCH_FOLLOWUP_HOST','DISPATCH_FOLLOWUP_INBOX#OPEN']}}},
 {'Effect':'Allow','Action':['dynamodb:PutItem'],'Resource':base+'staging-PlatformStaff','Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['CONTROL#DISPATCH_FOLLOWUP_HOST']}}},
 {'Effect':'Allow','Action':['dynamodb:PutItem','dynamodb:DeleteItem'],'Resource':base+'staging-PlatformStaff','Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['DISPATCH_FOLLOWUP_INBOX#OPEN']}}},
 {'Effect':'Allow','Action':['dynamodb:Query'],'Resource':base+'staging-PlatformStaff','Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['DISPATCH_FOLLOWUP_INBOX#OPEN']}}},
 {'Effect':'Allow','Action':['dynamodb:Query'],'Resource':base+'WizzDispatchJobs_staging/index/DispatchReviewStatus340'}]}
I.put_role_policy(RoleName=role,PolicyName='DispatchFollowup340',PolicyDocument=json.dumps(policy));receipt['iam']={'role':role,'policy':'DispatchFollowup340','newFinancialPermissions':False,'newQueryIndex':'DispatchReviewStatus340','inboxPartition':'DISPATCH_FOLLOWUP_INBOX#OPEN'};save();print('Published bounded observation permissions',flush=True)
table=DB.Table('staging-PlatformStaff');key={'pk':'OPERATIONAL_SETTINGS#DISPATCH_FOLLOWUP','sk':'CURRENT'};current=table.get_item(Key=key,ConsistentRead=True).get('Item')
if not current:
 stamp=datetime.datetime.now(datetime.timezone.utc).isoformat();current={**key,'version':1,'policyVersion':'INITIAL_340','values':{'reviewMinutes':5,'escalationMinutes':15},'updatedBy':'SYSTEM_DEPLOYMENT_340','updatedAt':stamp,'effectiveFor':'NEW_REVIEW_CASES'}
 table.put_item(Item=current,ConditionExpression='attribute_not_exists(pk)');table.put_item(Item={**current,'sk':'VERSION#INITIAL_340'},ConditionExpression='attribute_not_exists(pk)')
receipt['policyInitializedOrPreserved']={'version':int(current['version']),'reviewMinutes':int(current['values']['reviewMinutes']),'escalationMinutes':int(current['values']['escalationMinutes'])};save()
for row in review['functions']:
 name=row['name'];c=L.get_function_configuration(FunctionName=name);assert c['CodeSha256']==row['baseCodeSha256'];data=(P/(row['tag']+'-candidate.zip')).read_bytes();L.update_function_code(FunctionName=name,RevisionId=c['RevisionId'],ZipFile=data,Publish=False);after=wait(name);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(data).digest()).decode()
 for k in ['Handler','Role','Runtime','Timeout','MemorySize','Architectures','Environment','Layers','VpcConfig']:assert after.get(k)==c.get(k),k
 receipt['functions'].append({**row,'configurationPreserved':True,'publishedCodeSha256':after['CodeSha256']});save();print('Published and verified '+name,flush=True)
for _ in range(120):
 t=D.describe_table(TableName='WizzDispatchJobs_staging')['Table'];idx=next((i for i in t.get('GlobalSecondaryIndexes',[])if i['IndexName']=='DispatchReviewStatus340'),None)
 if idx and idx['IndexStatus']=='ACTIVE':break
 time.sleep(5)
else:raise RuntimeError('Status index pending; monitor gate remains off')
receipt['index']={'name':'DispatchReviewStatus340','status':'ACTIVE','projection':'KEYS_ONLY'}
name='staging-cod-integration';c=L.get_function_configuration(FunctionName=name);variables={**c['Environment']['Variables'],'DISPATCH_FOLLOWUP_MODE':'REQUIRED','DISPATCH_FOLLOWUP_JOB_INDEX':'DispatchReviewStatus340'};L.update_function_configuration(FunctionName=name,RevisionId=c['RevisionId'],Environment={'Variables':variables});after=wait(name);assert after['Environment']['Variables']==variables
receipt['monitorGate']='REQUIRED';receipt['status']='BACKEND_PUBLISHED_VERIFIED';receipt['publishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save();print('PASS backend and status index verified; scheduled observation enabled',flush=True)
