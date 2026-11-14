import pathlib,zipfile,copy,json,hashlib,subprocess
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/return-item-plan-263');records=[]
wrapper=b'''\n// Custody plan 263: route only the reviewed-plan action; preserve all existing financial handlers.\nmodule.exports=((previous)=>({...previous,createExceptionCaseAdministration:options=>{const existing=previous.createExceptionCaseAdministration(options);const plan=require("./return-item-plan-runtime-263.js").createReturnItemCustodyPlan(options);return value=>value?.action==="AUTHORIZE_RETURN_ITEM_PLAN"?plan(value):existing(value);}}))(module.exports);\n'''
for label in ['financial','staff']:
 with zipfile.ZipFile(p/(label+'-base.zip'))as old:
  if label=='financial':
   raw=old.read('order-exception-runtime-229.js');assert b'return-items-runtime-262.js'in raw and b'Custody plan 263'not in raw
   changes={'order-exception-runtime-229.js':raw+wrapper,'return-item-plan-runtime-263.js':(r/'backend/shared/return-item-plan-runtime-263.js').read_bytes()}
   index=old.read('index.js');start=index.rfind(b'async function financialAcceptanceHandler(');assert start>=0;at=index.index(b'const allowed = [',start)+len(b'const allowed = [');changes['index.js']=index[:at]+b'"INVALID_RETURN_ITEM_PLAN", "RETURN_ITEM_PLAN_CONFLICT", '+index[at:]
  else:
   raw=(r/'backend/staff-service/order-exception-cases.js').read_bytes();before=old.read('order-exception-cases.js');assert raw.replace(b'receipt:row.itemReceipt||null,plan:row.itemCustodyPlan||null}',b'receipt:row.itemReceipt||null}',1).replace(b'"noAutomaticCharge","plan"].filter',b'"noAutomaticCharge"].filter',1)==before;changes={'order-exception-cases.js':raw}
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for e in old.infolist():out.writestr(copy.copy(e),changes.get(e.filename,old.read(e.filename)))
   for n,b in changes.items():
    if n not in old.namelist():out.writestr(n,b)
  with zipfile.ZipFile(p/(label+'-candidate.zip'))as out:
   assert all(old.read(n)==out.read(n)for n in old.namelist()if n not in changes)
   for n,b in changes.items():
    if n.endswith('.js'):
     q=p/'syntax.js';q.write_bytes(b);subprocess.run(['node','--check',str(q)],check=True,capture_output=True)
  config=json.loads((p/(label+'-config.private.json')).read_text());records.append({'label':label,'function':config['FunctionName'],'changedFiles':list(changes),'baseCodeSha256':config['CodeSha256'],'packageSha256':hashlib.sha256((p/(label+'-candidate.zip')).read_bytes()).hexdigest(),'unrelatedEntriesPreserved':True})
(p/'packages.json').write_text(json.dumps(records,indent=2));print(json.dumps(records,indent=2))
local=r/'backend/shared/order-exception-runtime-229.js';raw=local.read_bytes()
if b'Custody plan 263'not in raw:local.write_bytes(raw+wrapper)
