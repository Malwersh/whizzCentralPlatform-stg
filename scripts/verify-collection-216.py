"""Read-only verification of deployed code, bounded access and historical source coverage."""
import sys,pathlib,json,hashlib,decimal
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];s=session();l=s.client('lambda');iam=s.client('iam');db=s.resource('dynamodb');table=db.Table('staging-MerchantPlatform');pub=json.loads((root/'docs/merchant-collection-publication-216.json').read_text());result={'part':216,'readOnly':True,'functions':[],'sourceIndex':{},'permissions':[]}
for phase in ['retention','consumer','producer']:
 p=pub['phases'][phase];v=l.get_function_configuration(FunctionName=p['function']);assert v['CodeSha256']==p['codeSha256'] and v['LastUpdateStatus']=='Successful';result['functions'].append({'function':p['function'],'codeSha256':v['CodeSha256'],'verified':True})
access=json.loads(pathlib.Path('/private/tmp/settlement-216/access.json').read_text())
for kind,a in access.items():
 arn='arn:aws:iam::699561669180:policy/'+a['policyName'];v=iam.get_policy(PolicyArn=arn)['Policy'];doc=iam.get_policy_version(PolicyArn=arn,VersionId=v['DefaultVersionId'])['PolicyVersion']['Document'];assert doc==a['document'];assert any(p['PolicyArn']==arn for p in iam.list_attached_role_policies(RoleName=a['role'])['AttachedPolicies']);result['permissions'].append({'kind':kind,'policy':a['policyName'],'exactDeltaVerified':True})
def encode(x):return int(x) if isinstance(x,decimal.Decimal) else x
def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,default=encode).encode()).hexdigest()
coverage=table.get_item(Key={'pk':'SYSTEM#MERCHANT_ACCRUAL_INDEX','sk':'COVERAGE'},ConsistentRead=True)['Item'];hash=coverage.pop('digest');assert coverage['status']=='COMPLETE' and digest(coverage)==hash
source=json.loads((root/'docs/merchant-accrual-migration-216.json').read_text());assert coverage['sourceInventory']==source['sourceInventory'];result['coverageCertificateVerified']=True
for branch,expected in source['branches'].items():
 rows=[];cursor=None
 while True:
  r=table.query(KeyConditionExpression='pk=:pk AND begins_with(sk,:p)',ExpressionAttributeValues={':pk':'MERCHANT_ACCRUAL#'+branch,':p':'DELIVERED#'},ConsistentRead=True,**({'ExclusiveStartKey':cursor} if cursor else {}));rows.extend(r['Items']);cursor=r.get('LastEvaluatedKey')
  if not cursor:break
 seen=set();net=0
 for row in rows:
  body={k:v for k,v in row.items() if k not in ['pk','sk','digest']};assert row['branchId']==branch and row['kind']=='MERCHANT_ACCRUAL_INDEX_ENTRY' and row['digest']==digest(body) and row['sk']=='DELIVERED#'+row['deliveredAt']+'#'+row['orderId'];assert row['orderId'] not in seen;seen.add(row['orderId']);assert 'expiresAt' not in row and 'ttl' not in row;net+=int(row['merchantNetIqd'])
 assert len(rows)>=expected['count'];wallet=db.Table('staging-Wallets').get_item(Key={'walletId':'WALLET#MERCHANT#'+branch,'sk':'META'},ConsistentRead=True)['Item'];result['sourceIndex'][branch]={'verifiedOrderCount':len(rows),'merchantNetIqd':net,'currentPendingIqd':int(wallet['lockedBalance']),'walletVersion':int(wallet['version']),'zeroNetCount':sum(int(r['merchantNetIqd'])==0 for r in rows)}
result['hosting']=json.loads((root/'docs/merchant-collection-page-publication-216.json').read_text());assert result['hosting']['status']=='SUCCEED' and result['hosting']['hostedBytesVerified'] is True
(root/'docs/merchant-collection-live-verification-216.json').write_text(json.dumps(result,indent=2,default=encode)+'\n');print(json.dumps({'functionsVerified':len(result['functions']),'permissionDeltasVerified':len(result['permissions']),'coverageVerified':True,'branches':result['sourceIndex'],'hostingJob':result['hosting']['jobId'],'financialWrites':False}))
