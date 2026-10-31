"""User-approved capacity five and one exact new test. No order, wallet, IAM or ledger writes."""
import boto3,pathlib,json,concurrent.futures
p=pathlib.Path('/private/tmp/scope-capacity-199');test=pathlib.Path('/private/tmp/agreement-device-198');s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');assert s.client('sts').get_caller_identity()['Account']=='699561669180';rows=json.loads((p/'manifest.json').read_text());plan=json.loads((test/'activation-plan.private.json').read_text());receipt={'part':199,'capacity':5,'explicitUserApproval':True,'historicalScopesPreserved':True,'financialDataWrites':False,'iamChanges':False,'functions':[],'activated':False};doc=pathlib.Path('docs/discount-tip-test-199.json')
def save():doc.write_text(json.dumps(receipt,indent=2)+'\n')
def code(row):
 n=row['name'];old=json.loads((p/(n+'.config.private.json')).read_text());c=l.get_function_configuration(FunctionName=n);assert c['CodeSha256'] in [row['baseSha'],row['candidateSha']];
 if c['CodeSha256']==row['candidateSha']:
  assert c['Environment']['Variables']==old['Environment']['Variables'];return {'name':n,'codeSha':c['CodeSha256'],'capacityVerified':True}
 assert c['RevisionId']==row['revisionId'];l.update_function_code(FunctionName=n,RevisionId=c['RevisionId'],ZipFile=(p/(n+'.candidate.zip')).read_bytes());l.get_waiter('function_updated_v2').wait(FunctionName=n,WaiterConfig={'Delay':2,'MaxAttempts':90});a=l.get_function_configuration(FunctionName=n);assert a['CodeSha256']==row['candidateSha'] and a['Environment']['Variables']==old['Environment']['Variables'] and a['Role']==old['Role'];print('Capacity verified:',n,flush=True);return {'name':n,'codeSha':a['CodeSha256'],'capacityVerified':True}
save()
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for r in pool.map(code,rows):receipt['functions'].append(r);save()
for old in plan['configs']:
 c=l.get_function_configuration(FunctionName=old['FunctionName']);assert c['Environment']['Variables']==old['Environment']['Variables']
for n in [r['name'] for r in rows if r['name']!='WizzUser-CreateOrder-staging']+['WizzUser-CreateOrder-staging']:
 c=l.get_function_configuration(FunctionName=n);e={**c['Environment']['Variables'],**plan['changes']}
 if n=='order-receiver-merchant-orders-staging-v1':
  import zipfile,re
  with zipfile.ZipFile(p/(n+'.candidate.zip')) as z: source='\n'.join(z.read(k).decode(errors='replace') for k in z.namelist() if k.endswith('.js') and not k.startswith('node_modules/'))
  unused=['BUSINESS_WORKING_HOURS_TABLE','BUSINESS_SUBCATEGORIES_TABLE','USERS_TABLE','CATEGORIES_TABLE','DISCOUNTS_TABLE','PRODUCTS_TABLE','POS_LOGS_TABLE','BUSINESS_SETTINGS_TABLE']
  for key in unused:
   assert not re.search(r'\b'+re.escape(key)+r'\b',source);e.pop(key,None)
  receipt['unusedReceiverSettingsRemoved']=unused
 assert len(json.dumps(e,separators=(',',':')).encode())<4096
 l.update_function_configuration(FunctionName=n,RevisionId=c['RevisionId'],Environment={'Variables':e});l.get_waiter('function_updated_v2').wait(FunctionName=n,WaiterConfig={'Delay':2,'MaxAttempts':90});a=l.get_function_configuration(FunctionName=n);assert a['CodeSha256']==c['CodeSha256'] and a['Environment']['Variables']==e;next(r for r in receipt['functions'] if r['name']==n)['admissionVerified']=True;save();print('Admission verified:',n,flush=True)
receipt.update(activated=True,scopeId=plan['scope']['scopes'][-1]['id'],orderId=plan['scope']['scopes'][-1]['orders'][0]['orderId'],admitUntil=plan['scope']['scopes'][-1]['admitUntil'],discount={'id':'1f08d5e5-f95a-4d52-b5bf-fe05dd626ce0','percentage':10},suggestedTipIqd=500);save()
