import pathlib,zipfile,copy,json,hashlib,subprocess
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/return-continuation-264');records=[]
wrapper=b'''\n// Continuation 264: authenticated custody execution and appeals, isolated from existing monetary implementations.\nmodule.exports=((previous,runtime)=>({...previous,createReturnContinuation:runtime.createReturnContinuation,createExceptionCaseAdministration:options=>{const original=previous.createExceptionCaseAdministration(options),financial=previous.createExceptionCaseAdministration({...options,db:runtime.guardReturnCaseFinancialDb(options.db)}),continuation=runtime.createReturnContinuation({...options,authenticate:options.authority.authenticate}),plan=runtime.createReturnItemCustodyPlan(options);return value=>runtime.RETURN_CONTINUATION_ACTIONS.includes(value?.action)?continuation.execute(value,"STAFF"):value?.action==="AUTHORIZE_RETURN_ITEM_PLAN"?plan(value):["CLOSE_EXCEPTION_FINANCIALS","APPROVE_EXCEPTION_ENTITLEMENTS","EXECUTE_EXCEPTION_ENTITLEMENTS","APPROVE_EXCEPTION_GUARANTEE","EXECUTE_EXCEPTION_GUARANTEE","RELEASE_RETURN_GUARANTEE"].includes(value?.action)?financial(value):original(value);},createStagingCodReturn:options=>runtime.decorateReturnFactory(options,previous.createStagingCodReturn(options))}))(module.exports,require("./return-continuation-runtime-264.js"));\n'''
errors=['RETURN_CONTINUATION_CONFLICT','INVALID_RETURN_CONTINUATION','RETURN_ITEM_PLAN_REQUIRED','RETURN_ITEM_PLAN_LOCKED','RETURN_RECIPIENT_UNAVAILABLE','RETURN_RECIPIENT_REQUIRED','RETURN_HANDOVER_REQUIRED','RETURN_LOSS_FINDING_REQUIRED','RETURN_DISPOSAL_AUTHORIZATION_REQUIRED','RETURN_CUSTODY_WORK_REMAINS','CASE_APPEAL_ALREADY_OPEN','CASE_APPEAL_WINDOW_EXPIRED','EXCEPTION_APPEAL_PENDING','EXCEPTION_APPEAL_CORRECTION_REQUIRED','RETURN_CONTINUATION_LIMIT']
for label in ['financial','staff','merchant','driver']:
 changes={}
 with zipfile.ZipFile(p/(label+'-base.zip'))as old:
  if label=='financial':
   raw=old.read('order-exception-runtime-229.js');assert b'Custody plan 263'in raw and b'Continuation 264'not in raw;changes['order-exception-runtime-229.js']=raw+wrapper;changes['return-continuation-runtime-264.js']=(r/'backend/shared/return-continuation-runtime-264.js').read_bytes()
   index=old.read('index.js').decode();start=index.index('async function financialCodReturn(');end=index.index('\nasync function ',start+10);section=index[start:end];needle="'consent_return', 'set_return_acceptance'].includes(action)";assert section.count(needle)==1;section=section.replace(needle,"'consent_return', 'set_return_acceptance', 'return_case_owner'].includes(action)",1);needle='    const operations = require("./order-exception-runtime-229.js").createReturnOperations';assert section.count(needle)==1;section=section.replace(needle,'    if (["return_case_owner","return_case_driver"].includes(action)) return require("./order-exception-runtime-229.js").createReturnContinuation({db,authenticate,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash}).execute(body,owner?"MERCHANT_OWNER":"DRIVER");\n'+needle,1);index=index[:start]+section+index[end:]
   start=index.rfind('async function financialAcceptanceHandler(');section=index[start:];needle="'set_return_acceptance', 'report_return_obstacle', 'read_customer_cancellation'";assert section.count(needle)==1;section=section.replace(needle,"'set_return_acceptance', 'return_case_owner', 'return_case_driver', 'report_return_obstacle', 'read_customer_cancellation'",1);needle="['set_return_acceptance', 'report_return_obstacle'].includes(event.action)";assert section.count(needle)==1;section=section.replace(needle,"['set_return_acceptance', 'report_return_obstacle', 'return_case_owner', 'return_case_driver'].includes(event.action)",1);needle='const allowed = [';at=section.index(needle)+len(needle);section=section[:at]+', '.join(json.dumps(e)for e in errors)+', '+section[at:];changes['index.js']=(index[:start]+section).encode()
  elif label=='staff':changes['order-exception-cases.js']=(r/'backend/staff-service/order-exception-cases.js').read_bytes()
  elif label=='merchant':
   raw=old.read('order_returns.js');needle=b'  const cancel = event.path === "/auth/order-cancellation";';assert raw.count(needle)==1;changes['order_returns.js']=raw.replace(needle,b'  if(event.path === "/auth/order-returns" && input?.custodyAction !== undefined) return require("./return_continuation_proxy.js").route({db,sub},event,input,client);\n'+needle,1);changes['return_continuation_proxy.js']=(p/'return_continuation_proxy.js').read_bytes()
  else:
   for name in ['lambda_driver_api_v2.js','financial-accept-client.js']:
    raw=(r.parent/'whizzDrivers-stg/backend'/name).read_bytes();base=old.read(name)
    if name=='lambda_driver_api_v2.js':
     a=raw.index(b'    const continuationPath=');b=raw.index(b'    // Financial return:',a);prefix=b'\'use strict\';\nrequire("./finance-rollout-config-208.js").restoreFinanceRolloutConfig();\n';assert prefix+raw[:a]+raw[b:]==base;raw=prefix+raw
    else:assert raw.replace(b"'return_case_driver','read_offer'",b"'read_offer'",1).replace(b"['return_case_driver','request_return'",b"['request_return'",1)==base
    changes[name]=raw
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for e in old.infolist():out.writestr(copy.copy(e),changes.get(e.filename,old.read(e.filename)))
   for n,b in changes.items():
    if n not in old.namelist():out.writestr(n,b)
  with zipfile.ZipFile(p/(label+'-candidate.zip'))as out:
   assert all(old.read(n)==out.read(n)for n in old.namelist()if n not in changes)
   for n,b in changes.items():
    if n.endswith('.js'):
     q=p/'syntax.js';q.write_bytes(b);subprocess.run(['node','--check',str(q)],check=True,capture_output=True)
  cfg=json.loads((p/(label+'-config.private.json')).read_text());records.append({'label':label,'function':cfg['FunctionName'],'changedFiles':list(changes),'baseCodeSha256':cfg['CodeSha256'],'packageSha256':hashlib.sha256((p/(label+'-candidate.zip')).read_bytes()).hexdigest(),'unrelatedEntriesPreserved':True})
(p/'packages.json').write_text(json.dumps(records,indent=2));print(json.dumps([{k:v for k,v in f.items()if k in ['label','function','changedFiles']}for f in records],indent=2))
local=r/'backend/shared/order-exception-runtime-229.js';raw=local.read_bytes()
if b'Continuation 264'not in raw:local.write_bytes(raw+wrapper)
