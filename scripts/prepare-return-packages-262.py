"""Overlay only the new receipt factory, owner proxy and staff read projection."""
import pathlib,zipfile,copy,json,hashlib,subprocess
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/return-items-262');m=r.parent/'whizzMerchants-stg';records=[]
for label in ['financial','merchant','staff']:
 changes={}
 with zipfile.ZipFile(p/(label+'-base.zip'))as old:
  if label=='financial':
   changes['return-items-runtime-262.js']=(r/'backend/shared/return-items-runtime-262.js').read_bytes();raw=old.read('order-exception-runtime-229.js');assert b'return-items-runtime-262.js'not in raw;changes['order-exception-runtime-229.js']=raw+b'\n// Receipt quantities 262: replace only the authenticated COD-return factory.\nmodule.exports={...module.exports,createStagingCodReturn:require("./return-items-runtime-262.js").createStagingCodReturn};\n'
   index=old.read('index.js');start=index.rfind(b'async function financialAcceptanceHandler(');assert start>=0;at=index.index(b'const allowed = [',start)+len(b'const allowed = [');changes['index.js']=index[:at]+b'"RETURN_ITEMS_INVALID", '+index[at:]
  elif label=='merchant':
   name='order_returns.js';raw=old.read(name);needle=b'["businessId", "orderId", "offerId", "attempt", "returnId", "expectedVersion", "allItemsReceived", "condition", "driverResponsibility", "cashCollected"]';assert raw.count(needle)==1 and b'const v5 = read ? cancel ?'in raw;raw=raw.replace(needle,needle[:-1]+b', ...(v5?.itemReceipts !== undefined ? ["itemReceipts"] : [])]',1);needle=b'const allowed = ["CANCELLATION_CONFLICT"';assert raw.count(needle)==1;changes[name]=raw.replace(needle,b'const allowed = ["RETURN_ITEMS_INVALID", "CANCELLATION_CONFLICT"',1)
  else:
   name='order-exception-cases.js';before=old.read(name);raw=(r/'backend/staff-service'/name).read_bytes();assert raw.replace(b"returnItems:row.itemManifest?{manifest:row.itemManifest,receipt:row.itemReceipt||null}:null,",b'',1)==before;changes[name]=raw
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
   for k,b in changes.items():
    if k not in old.namelist():out.writestr(k,b)
  with zipfile.ZipFile(p/(label+'-candidate.zip'))as out:
   assert all(old.read(k)==out.read(k)for k in old.namelist()if k not in changes)
   for k,b in changes.items():
    if k.endswith('.js'):
     q=p/'syntax.js';q.write_bytes(b);subprocess.run(['node','--check',str(q)],check=True,capture_output=True)
  cfg=json.loads((p/(label+'-config.private.json')).read_text());records.append({'label':label,'function':cfg['FunctionName'],'changedFiles':list(changes),'baseCodeSha256':cfg['CodeSha256'],'packageSha256':hashlib.sha256((p/(label+'-candidate.zip')).read_bytes()).hexdigest(),'unrelatedEntriesPreserved':True})
(p/'packages.json').write_text(json.dumps(records,indent=2));print(json.dumps(records,indent=2))
