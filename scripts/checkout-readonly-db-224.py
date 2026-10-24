"""Local diagnostic RPC: real reads with execution-role simulation. Never writes DynamoDB."""
import sys,json,decimal,pathlib,os
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
s=session();db=s.resource('dynamodb');iam=s.client('iam');role=json.loads(pathlib.Path(os.environ.get('READONLY_CONFIG_PATH','/private/tmp/checkout-224/config.private.json')).read_text())['Role'];cache={}
def enc(x):
 if isinstance(x,decimal.Decimal):return int(x) if x==x.to_integral_value() else float(x)
 raise TypeError(type(x).__name__)
def authorize(action,q,key):
 resource='arn:aws:dynamodb:us-east-1:699561669180:table/'+q['TableName']+('/index/'+q['IndexName'] if q.get('IndexName') else '')
 contexts=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[str(key)]}]
 if q.get('Select'):contexts.append({'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':[q['Select']]})
 if q.get('ProjectionExpression'):
  names=q.get('ExpressionAttributeNames',{});attrs=[names.get(a.strip(),a.strip()).split('.')[0] for a in q['ProjectionExpression'].split(',')]
  contexts.append({'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':attrs})
 k=json.dumps([action,resource,contexts],sort_keys=True)
 if k not in cache:
  r=iam.simulate_principal_policy(PolicySourceArn=role,ActionNames=[action],ResourceArns=[resource],ContextEntries=contexts)['EvaluationResults'][0];cache[k]=r['EvalDecision']
 if cache[k]!='allowed':raise RuntimeError('ROLE_DENIED:'+action+':'+q['TableName'])
def send(name,q):
 if name=='GetCommand':
  authorize('dynamodb:GetItem',q,next(iter(q['Key'].values())))
  return db.Table(q['TableName']).get_item(**{k:v for k,v in q.items() if k!='TableName'})
 if name=='QueryCommand':
  expr=q['KeyConditionExpression'];values=q['ExpressionAttributeValues'];import re
  m=re.search(r'\w+\s*=\s*(:\w+)',expr)
  if not m:raise RuntimeError('UNSUPPORTED_QUERY')
  authorize('dynamodb:Query',q,values[m.group(1)])
  return db.Table(q['TableName']).query(**{k:v for k,v in q.items() if k!='TableName'})
 if name=='TransactWriteCommand':
  # Emulate only nonexistence checks with strong reads. No transaction or write is sent.
  for op in q['TransactItems']:
   if set(op)!=set(['ConditionCheck']):raise RuntimeError('FINANCIAL_OR_ORDER_WRITE_BLOCKED')
   check=op['ConditionCheck'];authorize('dynamodb:ConditionCheckItem',check,next(iter(check['Key'].values())))
   if check['ConditionExpression']!='attribute_not_exists(pk)':raise RuntimeError('UNSUPPORTED_READONLY_FENCE')
   if db.Table(check['TableName']).get_item(Key=check['Key'],ConsistentRead=True).get('Item'):raise RuntimeError('LIFECYCLE_FENCE_PRESENT')
  return {}
 raise RuntimeError('UNSUPPORTED_OR_MUTATING_COMMAND:'+name)
for line in sys.stdin:
 try:
  r=json.loads(line);out={'id':r['id'],'ok':True,'result':send(r['name'],r['input'])}
 except Exception as e:out={'id':r.get('id'),'ok':False,'error':str(e)}
 print(json.dumps(out,default=enc),flush=True)
