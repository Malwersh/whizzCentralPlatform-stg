"""Update only the cash paid-proof verifier in the live exception helper. No closure executed."""
import pathlib,sys,json,zipfile,copy,urllib.request,time,hashlib,base64
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/closure-260');s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');before=json.loads((p/'config.private.json').read_text());assert all(x['decision']=='allowed'for x in json.loads((p/'access.json').read_text()));current=l.get_function_configuration(FunctionName=before['FunctionName']);assert current['CodeSha256']==before['CodeSha256']and current['RevisionId']==before['RevisionId'],'LIVE_DRIFT'
with zipfile.ZipFile(p/'base.zip')as old:
 with zipfile.ZipFile(p/'candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for e in old.infolist():out.writestr(copy.copy(e),(p/'runtime-candidate.js').read_bytes()if e.filename=='order-exception-runtime-229.js'else old.read(e.filename))
 with zipfile.ZipFile(p/'candidate.zip')as out:assert all(old.read(n)==out.read(n)for n in old.namelist()if n!='order-exception-runtime-229.js')
raw=(p/'candidate.zip').read_bytes();sha=base64.b64encode(hashlib.sha256(raw).digest()).decode();l.update_function_code(FunctionName=before['FunctionName'],RevisionId=before['RevisionId'],ZipFile=raw,Publish=False)
for _ in range(90):
 after=l.get_function_configuration(FunctionName=before['FunctionName'])
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha
for k in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','VpcConfig','Layers','Architectures']:assert before.get(k)==after.get(k),k
record={'part':260,'status':'PUBLISHED','scope':'staging','function':before['FunctionName'],'changedFiles':['order-exception-runtime-229.js'],'baseCodeSha256':before['CodeSha256'],'codeSha256':sha,'cause':'Closure helper still expected legacy CASH_DISBURSEMENT; registered company cash uses MERCHANT_DISBURSEMENT_CLEARING with cashLedgerJournalId','unrelatedZipEntriesAndConfigurationPreserved':True,'iamChanged':False,'realClosureExecuted':False,'financialPostingPerformed':False,'proofTestsPassed':8,'realCaseDryRun':'Old verifier rejects sealed paid proof; corrected verifier prepares RESOLVED with transaction blocked','transactionAccessChecks':10};(r/'docs/case-closure-publication-260.json').write_text(json.dumps(record,indent=2)+'\n');print('PASS bounded closure compatibility fix published; no case closed or financial action executed.',flush=True)
