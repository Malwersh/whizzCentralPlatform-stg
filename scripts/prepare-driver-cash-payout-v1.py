"""Build minimal guarded candidates; never publish or mutate business data."""
from pathlib import Path
import json,zipfile,copy,hashlib,base64,difflib,subprocess
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-cash-payout-v1');rows=json.loads((P/'captured.json').read_text())
subprocess.run([str(R/'backend/wallet-service/node_modules/.bin/esbuild'),str(R/'backend/wallet-service/src/driverCashPayoutRuntime.ts'),'--bundle','--platform=node','--target=node22','--keep-names','--outfile='+str(P/'driver-cash-payout-runtime-v1.js')],check=True)
report=[]
for row in rows:
 folder=P/row['name'];changes={}
 with zipfile.ZipFile(folder/'base.zip')as old:
  if row['name']=='staging-driver-financial-accept':
   original=old.read('index.js');assert b'driver-cash-payout-runtime-v1'not in original
   changes['driver-cash-payout-original-v1.js']=original
   changes['driver-cash-payout-runtime-v1.js']=(P/'driver-cash-payout-runtime-v1.js').read_bytes()
   changes['index.js']=b"'use strict';\nconst previous=require('./driver-cash-payout-original-v1');\nmodule.exports={...previous,financialAcceptanceHandler:(event,...args)=>['driver_cash_payout','staff_driver_cash_payout'].includes(event?.action)?require('./driver-cash-payout-runtime-v1').handler(event):previous.financialAcceptanceHandler(event,...args)};\n"
  elif row['name']=='DriversApi-staging':
   source=old.read('lambda_driver_api_v2.js').decode();needle="    if ((path === '/driver/quality-incidents' "
   current=(R.parent/'whizzDrivers-stg/backend/lambda_driver_api_v2.js').read_text();a=current.index("    if ((path === '/driver/cash-payouts'");b=current.index(needle,a);assert source.count(needle)==1
   changes['lambda_driver_api_v2.js']=source.replace(needle,current[a:b]+needle).encode()
   source=old.read('financial-accept-client.js').decode();assert "['driver_quality_case'"in source
   source=source.replace("['driver_quality_case'","['driver_cash_payout','driver_quality_case'",1).replace('{code:response.code}','{code:response.code,statusCode:response.statusCode}')
   changes['financial-accept-client.js']=source.encode()
  elif row['name']=='staging-wizz-staff-service':
   entry='_discount_review/central-staff/index.js';source=old.read(entry).decode();needle="  if(path==='/staff/order-management')";assert source.count(needle)==1
   insertion="  if(path==='/staff/driver-cash-payouts'&&method==='POST')return response(200,await require('./driver-cash-payouts').route({db,allowed,enrolled,recent,claims,accessToken:token},actor,input));\n"
   changes[entry]=source.replace(needle,insertion+needle).encode();changes['_discount_review/central-staff/driver-cash-payouts.js']=(R/'backend/staff-service/driver-cash-payouts.js').read_bytes()
  elif row['name']=='staging-wizz-wallet-service':
   entry='dist/ledgerEffects.js';changes[entry]=(R/'backend/wallet-service/dist/ledgerEffects.js').read_bytes()
   diff=list(difflib.unified_diff(old.read(entry).decode().splitlines(),changes[entry].decode().splitlines()));assert len(diff)<90,'UNRELATED_LEDGER_DRIFT';(folder/'ledger.diff').write_text('\n'.join(diff))
  elif row['name']=='staging-wizz-wallet-notification-worker':
   entry='index.js';source=old.read(entry).decode();needle=" const dispatch=item.type==='dispatch_offer_closed';";assert source.count(needle)==1
   current=(R/'backend/wallet-service/notification-worker/index.js').read_text();a=current.index(" if(item.type==='wallet_cash_payout')");b=current.index(needle,a);changes[entry]=source.replace(needle,current[a:b]+needle).encode()
  with zipfile.ZipFile(folder/'candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
   for entry in old.infolist():out.writestr(copy.copy(entry),changes.get(entry.filename,old.read(entry.filename)))
   for name,body in changes.items():
    if name not in old.namelist():out.writestr(name,body)
  with zipfile.ZipFile(folder/'candidate.zip')as out:assert all(old.read(name)==out.read(name)for name in old.namelist()if name not in changes)
  report.append({**row,'candidateHash':base64.b64encode(hashlib.sha256((folder/'candidate.zip').read_bytes()).digest()).decode(),'changedFiles':list(changes),'unchangedOtherEntries':True,'wholeFinancialHandlerRebuild':False})
(P/'packages.json').write_text(json.dumps(report,indent=2));print(json.dumps([{k:r[k]for k in ['name','changedFiles','unchangedOtherEntries']}for r in report],indent=2))
