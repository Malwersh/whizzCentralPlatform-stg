import pathlib,zipfile,copy,json,hashlib,subprocess
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/customer-cash-266');records=[]
for label in ['deletion','expiry','financial','staff','order','driver','monitor']:
 changes={}
 with zipfile.ZipFile(p/(label+'-base.zip'))as old:
  if label=='financial':
   index=old.read('index.js').decode();anchor='async function financialAcceptanceHandler(event) {';assert index.count(anchor)==1
   index=index.replace(anchor,anchor+'\n    if (["customer_cash_case","driver_cash_case","staff_cash_case"].includes(event?.action)) return require("./customer-cash-runtime-266.js").customerCashAcceptanceHandler(event);',1)
   a=index.index('function createFullCashCompletion(');b=index.index('__name(createFullCashCompletion',a);section=index[a:b];needle='"financialOutcome",';assert section.count(needle)==2;section=section.replace(needle,'"openPaymentClaimId",\n        '+needle);index=index[:a]+section+index[b:]
   changes['index.js']=index.encode();changes['customer-cash-runtime-266.js']=(r/'backend/shared/customer-cash-runtime-266.js').read_bytes()
   helper=old.read('order-exception-runtime-229.js');assert b'return-continuation-runtime-265.js'in helper and b'MERCHANT_DISBURSEMENT_CLEARING'in helper
   changes['order-exception-runtime-229.js']=helper+b'\n// Customer cash review 266: fence legacy returns against an unresolved cash collection.\nmodule.exports=((previous,runtime)=>({...previous,createStagingCodReturn:options=>previous.createStagingCodReturn({...options,db:runtime.guardCashReviewReturnDb(options.db)})}))(module.exports,require("./customer-cash-runtime-266.js"));\n'
  elif label=='staff':
   changes['order-exception-cases.js']=(r/'backend/staff-service/order-exception-cases.js').read_bytes();changes['order-exception-case-client.js']=(p/'staff-client.js').read_bytes()
   # Keep every unrelated source change out of this overlay.
   src=changes['order-exception-cases.js'].decode();base=old.read('order-exception-cases.js').decode();branch="row.kind==='CUSTOMER_CASH_REVIEW_CASE'?{caseId:row.caseId,type:'CUSTOMER_CASH_REVIEW',status:row.state,reason:'مراجعة مبلغ الدفع ورد أموال الزبون',responsibility:'UNDETERMINED',customerCash:financial?{reports:row.reports||[],collectionVerification:row.collectionVerification||null,refunds:row.refunds?.refunds||[],shortfallDecision:row.shortfallDecision||null}:null}:"
   check=src.replace(branch,'',1).replace("'MERCHANT_CANCELLATION','CUSTOMER_CASH_REVIEW'","'MERCHANT_CANCELLATION'",1)
   check=check.replace("...(c.row.kind==='CUSTOMER_CASH_REVIEW_CASE'?{cashPermissions:{operate:ctx.allowed(actor,'orders.cancel')||ctx.allowed(actor,'finance.approve'),approve:ctx.allowed(actor,'finance.approve'),execute:ctx.allowed(actor,'finance.request')}}:{}),",'',1)
   check=check.replace("  const cashExecution=input.caseKey==='CUSTOMER_CASH_REVIEW'&&input.action==='EXECUTE_CUSTOMER_REFUND'&&ctx.allowed(actor,'finance.request');\n",'',1).replace("&&!cashExecution)",")",1)
   assert check==base
  elif label=='order':
   index=old.read('dist/index.js').decode();anchor="        if (httpMethod === 'POST' && ['/order/cancel', '/order/unassign'].includes(path)) {";assert index.count(anchor)==1
   block="""        if (httpMethod === 'POST' && path === '/order/cancel') {
            const input = (0, utils_1.parseBody)(event.body);
            if (input.workflow === 'CUSTOMER_CASH_REVIEW') {
                try { return (0, utils_1.buildSuccessResponse)(await require('../customer-cash-case-client').invokeCustomerCashCase(event, input), 200); }
                catch (e) { return (0, utils_1.buildErrorResponse)(e.status || 503, e.status ? e.message : 'CASH_REVIEW_UNAVAILABLE', 'تعذر تأكيد مراجعة النقد؛ حدّث الحالة قبل إعادة المحاولة'); }
            }
        }
"""
   changes['dist/index.js']=index.replace(anchor,block+anchor,1).encode();changes['customer-cash-case-client.js']=(r/'backend/order-service/customer-cash-case-client.js').read_bytes()
  elif label=='driver':
   d=r.parent/'whizzDrivers-stg/backend'
   for name in ['lambda_driver_api_v2.js','financial-accept-client.js']:
    raw=(d/name).read_bytes();base=old.read(name)
    if name=='lambda_driver_api_v2.js':
     a=raw.index(b'    const cashReviewPath=');b=raw.index(b'    const continuationPath=',a);prefix=b'\'use strict\';\nrequire("./finance-rollout-config-208.js").restoreFinanceRolloutConfig();\n';assert prefix+raw[:a]+raw[b:]==base;raw=prefix+raw
    else:assert raw.replace(b"'driver_cash_case','return_case_driver'",b"'return_case_driver'")==base
    changes[name]=raw
  elif label in ['deletion','expiry']:
   raw=old.read('cod-retention.js').decode()
   patches=[("const {error}=require('./policy');", "const {error}=require('./policy');\nconst cashRetention=require('./customer-cash-retention');"),
    ('function codEvidence(row){','function codEvidence(row){\n if(cashRetention.supports(row))return cashRetention.evidence(row);'),
    (' return [...events,...dispatch];'," const cash=(await scan(db,'staging-Holds',maxPages)).filter(r=>cashRetention.pending(r)&&owned(r)).map(r=>({orderId:r.orderId,operationId:r.caseId,status:'CUSTOMER_CASH_REVIEW_PENDING'}));\n return [...events,...dispatch,...cash];"),
    ("   if(held(row))throw error('DOCUMENTED_RETENTION_HOLD');", "   if(held(row))throw error('DOCUMENTED_RETENTION_HOLD');\n   if(cashRetention.pending(row))throw error('COD_INTEGRATION_PENDING');")]
   for before,after in patches:
    assert raw.count(before)==1,(label,before);raw=raw.replace(before,after,1)
   changes['cod-retention.js']=raw.encode();changes['customer-cash-retention.js']=(r/'backend/account-deletion/customer-cash-retention.js').read_bytes()
  else:
   index=old.read('index.js').decode();needle='["CUSTOMER_CANCELLATION", "MERCHANT_CANCELLATION"].includes(pointer.caseKey)';assert index.count(needle)==1;index=index.replace(needle,'["CUSTOMER_CANCELLATION", "MERCHANT_CANCELLATION", "CUSTOMER_CASH_REVIEW"].includes(pointer.caseKey)',1)
   needle='const closed = ';assert index.count(needle)==1;index=index.replace(needle,needle+'row?.kind === "CUSTOMER_CASH_REVIEW_CASE" ? row.state === "CLOSED" : ',1);changes['index.js']=index.encode()
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for entry in old.infolist():out.writestr(copy.copy(entry),changes.get(entry.filename,old.read(entry.filename)))
   for n,b in changes.items():
    if n not in old.namelist():out.writestr(n,b)
  with zipfile.ZipFile(p/(label+'-candidate.zip'))as out:assert all(old.read(n)==out.read(n)for n in old.namelist()if n not in changes)
  for n,b in changes.items():
   if n.endswith('.js'):
    (p/'syntax.js').write_bytes(b);subprocess.run(['node','--check',str(p/'syntax.js')],check=True,capture_output=True)
  cfg=json.loads((p/(label+'-config.private.json')).read_text());records.append({'label':label,'function':cfg['FunctionName'],'baseCodeSha256':cfg['CodeSha256'],'packageSha256':hashlib.sha256((p/(label+'-candidate.zip')).read_bytes()).hexdigest(),'changedFiles':list(changes),'unrelatedEntriesPreserved':True})
(p/'packages.json').write_text(json.dumps(records,indent=2));print(json.dumps([{'label':f['label'],'changedFiles':f['changedFiles']}for f in records],indent=2))
# Extract the exact candidate modules for offline authenticated-factory tests.
target=p/'candidate-runtime';target.mkdir(exist_ok=True)
with zipfile.ZipFile(p/'financial-candidate.zip')as z:
 for n in z.namelist():
  if n.endswith('.js') and '/'not in n:(target/n).write_bytes(z.read(n))
