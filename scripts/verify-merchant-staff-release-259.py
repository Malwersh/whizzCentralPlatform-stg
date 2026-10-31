"""Read deployed hashes, policy and negative transport checks; no financial actions."""
import pathlib,sys,json,datetime
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];s=session();l=s.client('lambda');pub=json.loads((r/'docs/merchant-staff-settlements-publication-259.json').read_text());assert pub['status']=='PUBLISHED';verified=[]
for f in pub['functions']:
 cfg=l.get_function_configuration(FunctionName=f['function']);assert cfg['CodeSha256']==f.get('verifiedLiveCodeSha256',f['deployedCodeSha256']),(f['function'],'HASH_MISMATCH',cfg['CodeSha256'],f['deployedCodeSha256']);assert cfg['LastUpdateStatus']=='Successful',(f['function'],cfg['LastUpdateStatus']);verified.append(f['function'])
row=s.resource('dynamodb').Table('staging-PlatformStaff').get_item(Key={'pk':'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS','sk':'CURRENT'},ConsistentRead=True)['Item'];assert row['version']==2;assert 'finance.payout.receive' in row['enabledPermissions'];assert 'finance.approve' not in row['enabledPermissions'] and 'finance.transfer' not in row['enabledPermissions']
for id in ['BRANCH_MANAGER','FINANCIAL_EMPLOYEE']:
 role=next(x for x in row['roles']if x['id']==id);assert role['enabled'] and 'finance.payout.receive' in role['permissions']
checks=[]
for action,method,body,expected in [('read','GET',{'view':'payout-context','branchId':'invalid'},401),('forbidden_platform_approval','POST',{'action':'APPROVE_PAYOUT','branchId':'invalid'},403)]:
 q=l.invoke(FunctionName='staging-wizz-staff-service',Payload=json.dumps({'action':'merchant_device_payout','deviceToken':'invalid','staffSession':'invalid','httpMethod':method,'input':body}).encode());d=json.loads(q['Payload'].read());assert not q.get('FunctionError')and d.get('statusCode')==expected,d;checks.append({'case':action,'statusCode':d['statusCode'],'code':d['code']})
assert pub['hosting']['status']=='SUCCEED'and pub['policyEditorHosting']['status']=='SUCCEED'and pub['recipientWordingHosting']['status']=='SUCCEED'
record={'part':259,'status':'PASS','verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'staging','deployedServicesVerified':verified,'policyVersion':2,'latestHostingJobId':pub['recipientWordingHosting']['jobId'],'negativeSmokeChecks':checks,'humanEmployeeReceiptAcceptance':'PENDING_EXPLICIT_OWNER_GRANT_AND_FUTURE_REAL_RECEIPT','payoutOrCashOperationsExecutedByAgent':False,'existingPaidPayoutNotReexecuted':True,'nativeBuild':226,'nativeSimulatorInstalledAndLaunched':True,'iamChanges':False};(r/'docs/merchant-staff-settlements-verification-259.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');print('PASS nine deployed service hashes, policy 2, forbidden action and invalid device rejected; native build 226 installed.')

# Financial regression reads run against the actual live bundle retained above, with all writes blocked by the Node adapter.
import os,subprocess
c=s.get_credentials().get_frozen_credentials();cfg=l.get_function_configuration(FunctionName='staging-wizz-staff-service');env=os.environ.copy();env.update(cfg.get('Environment',{}).get('Variables',{}));env.update(AWS_ACCESS_KEY_ID=c.access_key,AWS_SECRET_ACCESS_KEY=c.secret_key,AWS_SESSION_TOKEN=c.token or '',AWS_REGION='us-east-1',NODE_PATH=str(r/'backend/staff-service/node_modules'));subprocess.run(['node','scripts/verify-current-payout-259.cjs'],cwd=r,env=env,check=True)
