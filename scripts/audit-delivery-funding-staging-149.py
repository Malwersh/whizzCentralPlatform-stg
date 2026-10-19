"""Read-only AWS package/role inventory. No write API operations or raw env output."""
import concurrent.futures,datetime,hashlib,io,json,os,pathlib,subprocess,sys,urllib.request,zipfile
OUT=pathlib.Path(sys.argv[1]);OUT.mkdir(mode=0o700,parents=True,exist_ok=True);os.chmod(OUT,0o700)
NAMES=['WizzUser-CreateOrder-staging','staging-wizz-staff-service','staging-driver-financial-accept','staging-cod-integration','staging-merchant-response-99','order-receiver-merchant-orders-staging-v1','WaveSystem_CreateDispatchJob','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout']
FLAGS=['DELIVERY_PROMOTION_MODE','FINANCIAL_DELIVERY_FUNDING_MODE','DELIVERY_FUNDING_MANAGEMENT_ENABLED','DELIVERY_QUOTE_MODE','COMMERCIAL_PRICING_MODE','DISPATCH_CYCLE_MODE','DISPATCH_LEGACY_HOST_MODE','MERCHANT_RESPONSE_MODE']
def save(name,value):
 p=OUT/name;p.write_text(json.dumps(value,ensure_ascii=False,indent=2,default=str)+'\n');os.chmod(p,0o600)
def aws(*args):
 p=subprocess.run(['aws',*args,'--profile','Wizz_stg_UserApp','--region','us-east-1','--output','json','--no-cli-pager','--cli-connect-timeout','8','--cli-read-timeout','25'],capture_output=True,text=True,env={**os.environ,'AWS_MAX_ATTEMPTS':'2'},timeout=40)
 if p.returncode:
  error='ACCESS_DENIED' if 'AccessDenied' in p.stderr else 'SESSION_EXPIRED' if any(x in p.stderr for x in ['ExpiredToken','SSO session','Token has expired']) else 'READ_FAILED'
  raise RuntimeError(error)
 return json.loads(p.stdout)
def capture(name):
 try:
  r=aws('lambda','get-function','--function-name',name);c=r['Configuration'];env=c.get('Environment',{}).get('Variables',{})
  row={'name':name,'role':c['Role'],'runtime':c.get('Runtime'),'handler':c['Handler'],'codeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'state':c.get('State'),'lastModified':c.get('LastModified'),'stage':env.get('STAGE',env.get('ENVIRONMENT')),'flags':{k:env.get(k,'ABSENT') for k in FLAGS}}
  if row['stage'] not in ['staging','stg'] and 'staging' not in name.lower():row['packageAudit']='SKIPPED_AMBIGUOUS_STAGE';return row
  data=urllib.request.urlopen(r['Code']['Location'],timeout=30).read();p=OUT/(name+'.zip');p.write_bytes(data);os.chmod(p,0o600)
  with zipfile.ZipFile(io.BytesIO(data)) as z:
   files=[]
   for entry in z.infolist():
    if not entry.filename.endswith(('.js','.cjs','.json')) or '/node_modules/' in '/'+entry.filename or entry.file_size>12000000:continue
    content=z.read(entry);markers=[x for x in ['DELIVERY_PROMOTION_MODE','FINANCIAL_DELIVERY_FUNDING_MODE','DELIVERY_FUNDING_MANAGEMENT_ENABLED','DRIVER_DELIVERY_FUNDED_OFFER','DELIVERY_RESERVATION#','MERCHANT_PENDING_CANCEL_JOURNAL'] if x.encode() in content]
    if markers or entry.filename.endswith(('financial-runtime.js','dispatch-cycle-runtime.js','merchant_pending_response.js','commercial-management.js','functions/create-order/index.js')):files.append({'path':entry.filename,'sha256':hashlib.sha256(content).hexdigest(),'markers':markers})
   row['files']=files;row['packageAudit']='READ'
  save(name+'.summary.private.json',row);return row
 except Exception as e:return {'name':name,'error':str(e) if str(e) in ['ACCESS_DENIED','SESSION_EXPIRED','READ_FAILED'] else type(e).__name__}
identity=aws('sts','get-caller-identity');assert identity['Account']=='699561669180','WRONG_ACCOUNT'
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(capture,NAMES))
roles=[]
for arn in sorted(set(r['role'] for r in rows if 'role' in r)):
 name=arn.rsplit('/',1)[-1];row={'arn':arn,'inline':[],'managed':[]}
 try:
  for policy in aws('iam','list-role-policies','--role-name',name)['PolicyNames']:
   doc=aws('iam','get-role-policy','--role-name',name,'--policy-name',policy)['PolicyDocument'];row['inline'].append({'name':policy,'document':doc})
  for policy in aws('iam','list-attached-role-policies','--role-name',name)['AttachedPolicies']:
   version=aws('iam','get-policy','--policy-arn',policy['PolicyArn'])['Policy']['DefaultVersionId'];doc=aws('iam','get-policy-version','--policy-arn',policy['PolicyArn'],'--version-id',version)['PolicyVersion']['Document'];row['managed'].append({'arn':policy['PolicyArn'],'version':version,'document':doc})
 except Exception as e:row['error']=str(e) if str(e) in ['ACCESS_DENIED','SESSION_EXPIRED','READ_FAILED'] else type(e).__name__
 save(name+'.policies.private.json',row);roles.append({'arn':arn,'inlineCount':len(row['inline']),'managedCount':len(row['managed']),'error':row.get('error')})
report={'part':149,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'accountId':identity['Account'],'readOnly':True,'applied':False,'functions':rows,'roles':roles};save('inventory.private.json',report)
print(json.dumps({'readOnly':True,'functions':[{'name':r['name'],'packageAudit':r.get('packageAudit'),'error':r.get('error'),'fundingMode':r.get('flags',{}).get('FINANCIAL_DELIVERY_FUNDING_MODE')} for r in rows],'rolesRead':sum(not r.get('error') for r in roles),'roleReadErrors':sum(bool(r.get('error')) for r in roles),'output':str(OUT)}))
