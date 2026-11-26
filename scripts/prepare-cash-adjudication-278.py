import pathlib,zipfile,copy,json,hashlib,subprocess
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/cash-adjudication-278');records=[]
for label in ['financial','staff','deletion','expiry']:
 with zipfile.ZipFile(p/(label+'-base.zip'))as old:
  if label=='financial':
   assert b'customer-cash-runtime-266.js'in old.read('index.js');changes={'customer-cash-runtime-266.js':(p/'customer-cash-runtime-266.js').read_bytes()}
  elif label=='staff':
   source=old.read('order-exception-cases.js').decode();patches=[('shortfallDecision:row.shortfallDecision||null','shortfallDecision:row.shortfallDecision||null,adjudication:row.adjudication||null,contactAttempts:row.contactAttempts||[]'),("input.action==='EXECUTE_CUSTOMER_REFUND'","['EXECUTE_CUSTOMER_REFUND','EXECUTE_CASH_ADJUDICATION'].includes(input.action)"),("return require('./order-exception-case-client').invoke(ctx.accessToken,input);","return require('./order-exception-case-client').invoke(ctx.accessToken,input.caseKey==='CUSTOMER_CASH_REVIEW'&&input.action==='OPEN_CASH_REVIEW'?{...input,orderId:await resolveOrder(input.orderId)}:input);")]
   for a,b in patches:assert source.count(a)==1,a;source=source.replace(a,b,1)
   assert source==(r/'backend/staff-service/order-exception-cases.js').read_text(),'Local staff module differs from bounded live overlay'
   changes={'order-exception-cases.js':source.encode()}
  else:changes={'customer-cash-retention.js':(r/'backend/account-deletion/customer-cash-retention.js').read_bytes()}
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for entry in old.infolist():out.writestr(copy.copy(entry),changes.get(entry.filename,old.read(entry.filename)))
  with zipfile.ZipFile(p/(label+'-candidate.zip'))as new:
   assert sorted(new.namelist())==sorted(old.namelist())
   for n in old.namelist():
    if n not in changes:assert new.read(n)==old.read(n)
  cfg=json.loads((p/(label+'-config.private.json')).read_text());records.append({'label':label,'function':cfg['FunctionName'],'baseCodeSha256':cfg['CodeSha256'],'packageSha256':hashlib.sha256((p/(label+'-candidate.zip')).read_bytes()).hexdigest(),'changedFiles':list(changes)})
(p/'packages.json').write_text(json.dumps(records,indent=2));print('Prepared four bounded overlays; unrelated ZIP entries preserved.')
