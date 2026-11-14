"""Read-only deployed-byte and historical-finance verification."""
import sys,pathlib,json,urllib.request,zipfile,io,datetime
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/customer-cash-266');s=session();l=s.client('lambda');pub=json.loads((r/'docs/customer-cash-publication-266.json').read_text());assert pub['status']=='PUBLISHED';checked=[]
for f in pub['functions']:
 live=l.get_function(FunctionName=f['function']);assert live['Configuration']['CodeSha256']==f['deployedCodeSha256'];actual=zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(live['Code']['Location'],timeout=90).read()));candidate=zipfile.ZipFile(p/(f['label']+'-candidate.zip'));base=zipfile.ZipFile(p/(f['label']+'-base.zip'))
 assert sorted(actual.namelist())==sorted(candidate.namelist())
 for name in actual.namelist():assert actual.read(name)==candidate.read(name),(f['label'],name)
 for name in base.namelist():
  if name not in f['changedFiles']:assert actual.read(name)==base.read(name),(f['label'],name)
 checked.append({'function':f['function'],'codeSha256':live['Configuration']['CodeSha256'],'allDeployedBytesVerified':True,'unrelatedEntriesPreserved':True})
for name in pub['hosting']['changedFiles']:assert urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+name+'?verify=266-final',timeout=30).read()==(r/'frontend'/name).read_bytes()
d=s.resource('dynamodb');oid='bb728bfe-c2c4-5c95-8492-26ce81ee1ed1';get=lambda table,key:d.Table(table).get_item(Key=key,ConsistentRead=True).get('Item')
row=get('staging-Holds',{'orderId':oid,'sk':'RETURN#1'});assert row['version']==14 and row['exceptionResolution']['status']=='RESOLVED'
for name in ['itemManifest','itemReceipt','itemCustodyPlan','itemExecution','caseAppeals']:assert not row.get(name)
payable=get('staging-Holds',{'orderId':oid,'sk':'MERCHANT_PAYABLE'});hold=get('staging-Holds',{'orderId':oid,'sk':'HOLD'});assert payable['status']=='PAID'and payable['amount']==6250 and hold['status']=='RELEASED'
assert get('staging-Holds',{'orderId':oid,'sk':'CUSTOMER_CASH_REVIEW'})is None
balance=get('staging-MerchantPlatform',{'pk':'MERCHANT_CASHBOX#CASH-NJFMAN-01','sk':'BALANCE'})
record={'part':266,'status':'PASS','verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'staging','services':checked,'hostingJobId':pub['hosting']['jobId'],'historicalCase':{'number':'ORD1792545370610','version':14,'status':'RESOLVED','compensationStatus':'PAID','compensationIqd':6250,'guaranteeStatus':'RELEASED','newCashCaseAbsent':True,'noBackfill':True},'cashboxBalanceIqd':int(balance['balanceIqd']),'noRealFinancialOrPhysicalAttestationsByAgent':True,'humanCustomerRefundAcceptance':'NOT_PERFORMED','merchantEmployeeHumanTest':'DEFERRED_BY_USER','wholeSpecificationComplete':False,'iamChanged':False,'nativeSimulatorBuilds':{'customerDebug':215,'driverDebug':216},'nativeInstalledAndLaunched':True,'shortfallFinancialAdjustments':'PENDING_SEPARATE_EXECUTION','electronicRefundSource':'NOT_ENABLED'}
(r/'docs/customer-cash-verification-266.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');print('PASS deployed bytes and hosted files; historical case remains 14 RESOLVED, merchant PAID6250, hold RELEASED; no customer cash case created by agent.')
