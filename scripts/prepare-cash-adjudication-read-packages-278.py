import pathlib,zipfile,copy,json,hashlib
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/cash-adjudication-278-read');records=[]
for label in ['staff','wallet','lifecycle']:
 with zipfile.ZipFile(p/(label+'-base.zip'))as old:
  if label=='staff':
   changes={'settlement-runtime.js':(p/'staff-runtime-candidate.js').read_bytes(),'cash-adjudication-read-278.js':(p/'cash-adjudication-read-278.js').read_bytes(),'settlement-evidence-fields.json':(r/'backend/staff-service/settlement-evidence-fields.json').read_bytes()}
   for name in ['merchant-account.js','settlement-orders.js']:
    oldtext=old.read(name).decode();new=(r/'backend/staff-service'/name).read_text();candidate=oldtext.replace("'COD_COMPLETED','FULL_CASH_COMPLETED','ORDER_EXCEPTION_FINANCIAL'","'COD_COMPLETED','FULL_CASH_COMPLETED','CASH_ADJUDICATION_SETTLED','ORDER_EXCEPTION_FINANCIAL'")
    if name=='merchant-account.js':
     candidate=candidate.replace('const labels={',"const labels={merchantAdministrativeAdjustment:'تصحيح إداري معتمد على مستحق المطعم',customerCashCollected:'المبلغ المحصل المثبت إداريًا',customerCashShortfall:'فرق النقد المعالج بقرار مستقل',").replace('const merchantFields=[',"const merchantFields=['merchantAdministrativeAdjustment','customerCashCollected','customerCashShortfall',")
    assert candidate==new,name;changes[name]=new.encode()
  else:
   target='dist/ledgerEffects.js';base=old.read(target);assert b'FULL_CASH_COMPLETED'in base
   patch=b'''\n// 278: classify explicit adjudication ledger movements; preserve all previous rules.\nexports.EFFECT_RULE_VERSION='LEDGER_EFFECTS_V7';\nexports.ledgerEffect=((previous)=>row=>{if(row?.category!=='CASH_ADJUDICATION_SETTLED')return previous(row);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(row.metadata?.decisionId??'')||!Number.isSafeInteger(row.metadata?.driverShortfallCreditIqd)||row.metadata.driverShortfallCreditIqd<0)return {status:'UNCLASSIFIED',reason:'INVALID_VALUES'};return previous({...row,category:'FULL_CASH_COMPLETED'});})(exports.ledgerEffect);\n'''
   changes={target:base+patch}
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for entry in old.infolist():out.writestr(copy.copy(entry),changes.get(entry.filename,old.read(entry.filename)))
   for name,raw in changes.items():
    if name not in old.namelist():out.writestr(name,raw)
  with zipfile.ZipFile(p/(label+'-candidate.zip'))as new:
   for n in old.namelist():
    if n not in changes:assert new.read(n)==old.read(n)
  cfg=json.loads((p/(label+'-config.private.json')).read_text());records.append({'label':label,'function':cfg['FunctionName'],'baseCodeSha256':cfg['CodeSha256'],'changedFiles':list(changes),'packageSha256':hashlib.sha256((p/(label+'-candidate.zip')).read_bytes()).hexdigest()})
(p/'packages.json').write_text(json.dumps(records,indent=2));print('Prepared bounded merchant-source and ledger-reading compatibility overlays.')
(r/'backend/staff-service/settlement-runtime.js').write_bytes((p/'staff-runtime-candidate.js').read_bytes());(r/'backend/staff-service/cash-adjudication-read-278.js').write_bytes((p/'cash-adjudication-read-278.js').read_bytes())
