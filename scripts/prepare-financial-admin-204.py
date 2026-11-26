"""Capture and prepare narrowly scoped financial admin fixes; no AWS writes."""
import boto3,json,pathlib,urllib.request,zipfile,copy,hashlib
r=pathlib.Path.cwd();p=pathlib.Path('/private/tmp/financial-admin-204');p.mkdir(exist_ok=True);p.chmod(0o700)
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');a=s.client('apigateway');i=s.client('iam')
c=l.get_function(FunctionName='staging-wizz-staff-service');(p/'staff-config.private.json').write_text(json.dumps(c['Configuration'],default=str));(p/'staff.zip').write_bytes(urllib.request.urlopen(c['Code']['Location']).read())
changes={n:(r/'backend/staff-service'/n).read_bytes() for n in ['settlement-schedules.js','settlement-orders.js','settlement-runtime.js','settlement-evidence-fields.json']}
with zipfile.ZipFile(p/'staff.zip') as old:
 with zipfile.ZipFile(p/'staff.candidate.zip','w',zipfile.ZIP_DEFLATED) as new:
  for item in old.infolist():new.writestr(copy.copy(item),changes.get(item.filename,old.read(item.filename)))
  for n,b in changes.items():
   if n not in old.namelist():new.writestr(n,b)
 with zipfile.ZipFile(p/'staff.candidate.zip') as new:assert all(old.read(n)==new.read(n) for n in old.namelist() if n not in changes)
methods=[]
for res,method in [('fnf8tc','GET'),('fzzeju','POST')]:
 m=a.get_method(restApiId='z14s5f8oxh',resourceId=res,httpMethod=method);methods.append({'resourceId':res,'method':method,'base':m})
(p/'methods.private.json').write_text(json.dumps(methods,default=str))
role=c['Configuration']['Role'].split('/')[-1]
policy={'Version':'2012-10-17','Statement':[]}
fields=json.loads((r/'backend/staff-service/settlement-evidence-fields.json').read_text())
for table,attrs in fields.items():
 action='dynamodb:Query' if table=='staging-LedgerEntries' else 'dynamodb:GetItem'
 leading=['WALLET#MERCHANT#*'] if table=='staging-LedgerEntries' else ['ORDER#*'] if table=='WizzOrders' else ['????????-????-????-????-????????????']
 statement={'Sid':'ReadProjected'+table.replace('-','').replace('_',''),'Effect':'Allow','Action':action,'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/'+table,'Condition':{'Null':{'dynamodb:Attributes':'false'},'ForAllValues:StringEquals':{'dynamodb:Attributes':attrs},'ForAllValues:StringLike':{'dynamodb:LeadingKeys':leading}}}
 if table=='staging-LedgerEntries':statement['Condition']['StringEquals']={'dynamodb:Select':'SPECIFIC_ATTRIBUTES'}
 policy['Statement'].append(statement)
(p/'read-policy.json').write_text(json.dumps(policy,indent=2))
# Compare deployed API export to current draft export to avoid publishing unrelated pending changes.
exports={}
for label,args in [('deployed',{'stageName':'staging'}),('draft',{})]:
 if label=='deployed':data=a.get_export(restApiId='z14s5f8oxh',stageName='staging',exportType='oas30',parameters={'extensions':'integrations,authorizers'},accepts='application/json')['body'].read();exports[label]=json.loads(data)
# get_export has no draft support: record all current method signatures to compare each deployed path.
resources=a.get_resources(restApiId='z14s5f8oxh',limit=500)['items'];drift=[]
for resource in resources:
 for method in resource.get('resourceMethods',{}):
  if method=='OPTIONS':continue
  m=a.get_method(restApiId='z14s5f8oxh',resourceId=resource['id'],httpMethod=method)
  path=exports['deployed'].get('paths',{}).get(resource['path'],{}).get('x-amazon-apigateway-any-method' if method=='ANY' else method.lower())
  if path is not None:
   integ=path.get('x-amazon-apigateway-integration',{});live=m.get('methodIntegration',{}); expected='CUSTOM' if path.get('security') else 'NONE'
   if m['authorizationType']!=expected or any(str(live.get(k,'')).lower()!=str(integ.get(k,'')).lower() for k in ['type','uri','httpMethod','passthroughBehavior']):drift.append({'path':resource['path'],'method':method,'type':'METHOD_DRIFT'})
  if path is None:drift.append({'path':resource['path'],'method':method,'type':'UNDEPLOYED_METHOD'})
(p/'api-deployed.private.json').write_text(json.dumps(exports['deployed']))
manifest={'part':204,'function':'staging-wizz-staff-service','baseSha':c['Configuration']['CodeSha256'],'revisionId':c['Configuration']['RevisionId'],'role':role,'changedEntries':list(changes),'candidateSha':hashlib.sha256((p/'staff.candidate.zip').read_bytes()).hexdigest(),'newReadOnlyPolicy':policy,'apiAuthFixes':[{'resourceId':x['resourceId'],'method':x['method'],'from':x['base']['authorizationType'],'to':'CUSTOM','authorizerId':'2bqq12'} for x in methods],'apiDrift':drift,'financialDataWrites':False,'sameAdminPolicy':'Existing designated staging DIRECT operators; owner consent remains mandatory'}
(p/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest,indent=2))
