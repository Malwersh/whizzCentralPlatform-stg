"""Read-only capture of notification Lambda and current successful staging web artifact."""
import base64,hashlib,json,os,pathlib,subprocess,sys,urllib.request
O=pathlib.Path(sys.argv[1]);O.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(O,0o700)
def aws(*args):
 p=subprocess.run(['aws',*args,'--profile','Wizz_stg_UserApp','--region','us-east-1','--output','json','--no-cli-pager','--cli-connect-timeout','8','--cli-read-timeout','30'],capture_output=True,text=True,env={**os.environ,'AWS_MAX_ATTEMPTS':'2'},timeout=60)
 if p.returncode:raise RuntimeError('READ_ONLY_CAPTURE_FAILED')
 return json.loads(p.stdout)
def save(name,r):
 p=O/name;p.write_text(json.dumps(r,indent=2)+'\n');os.chmod(p,0o600)
def download(url,name):
 data=urllib.request.urlopen(url,timeout=60).read();p=O/name;p.write_bytes(data);os.chmod(p,0o600);return data
assert aws('sts','get-caller-identity')['Account']=='699561669180'
name='wizzcentral-notifications-staging-pushSendMerchantOrder';r=aws('lambda','get-function','--function-name',name);c=r['Configuration'];assert c['Environment']['Variables'].get('STAGE',c['Environment']['Variables'].get('ENVIRONMENT')) in ['staging','stg']
data=download(r['Code']['Location'],name+'.zip');assert base64.b64encode(hashlib.sha256(data).digest()).decode()==c['CodeSha256']
row={k:c[k] for k in ['Role','Runtime','Handler','RevisionId','CodeSha256']};row['name']=name;save(name+'.summary.private.json',row)
role=c['Role'].rsplit('/',1)[-1];policies={'arn':c['Role'],'inline':[],'managed':[]}
for n in aws('iam','list-role-policies','--role-name',role)['PolicyNames']:policies['inline'].append({'name':n,'document':aws('iam','get-role-policy','--role-name',role,'--policy-name',n)['PolicyDocument']})
for p in aws('iam','list-attached-role-policies','--role-name',role)['AttachedPolicies']:
 v=aws('iam','get-policy','--policy-arn',p['PolicyArn'])['Policy']['DefaultVersionId'];policies['managed'].append({'arn':p['PolicyArn'],'version':v,'document':aws('iam','get-policy-version','--policy-arn',p['PolicyArn'],'--version-id',v)['PolicyVersion']['Document']})
save(role+'.policies.private.json',policies)
app='d2vmebm1e1n95m';jobs=aws('amplify','list-jobs','--app-id',app,'--branch-name','staging','--max-results','10')['jobSummaries'];job=next(j for j in jobs if j['status']=='SUCCEED');meta=aws('amplify','get-job','--app-id',app,'--branch-name','staging','--job-id',job['jobId'])['job'];url=next(s['artifactsUrl'] for s in meta['steps'] if s.get('artifactsUrl'));web=download(url,'frontend.base.zip')
record={'readOnly':True,'applied':False,'notification':row,'frontend':{'appId':app,'branch':'staging','jobId':job['jobId'],'artifactSha256':hashlib.sha256(web).hexdigest(),'observedJobs':[{'id':j['jobId'],'status':j['status']} for j in jobs]}};save('extra-inventory.private.json',record)
print(json.dumps({'notificationCaptured':True,'webCaptured':True,'appId':app,'branch':'staging','jobId':job['jobId'],'applied':False}))
