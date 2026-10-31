from pathlib import Path
import zipfile,json,subprocess
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-cash-payout-v1')
for name in ['staging-driver-financial-accept','DriversApi-staging','staging-wizz-staff-service','staging-wizz-wallet-service','staging-wizz-wallet-notification-worker']:
 folder=P/name/'unpacked';folder.mkdir(exist_ok=True)
 with zipfile.ZipFile(P/name/'candidate.zip')as z:z.extractall(folder)
 subprocess.run(['node','--check',str(folder/('lambda_driver_api_v2.js'if name=='DriversApi-staging'else'dist/ledgerEffects.js'if name=='staging-wizz-wallet-service'else'index.js'))],check=True)
financial=P/'staging-driver-financial-accept/unpacked';config=json.loads((financial.parent/'config.private.json').read_text())
# No original financial action is executed. Existing exports are checked and only
# an invalid new-action token is invoked, which must fail before Cognito or DynamoDB.
code="""
const path=require('path'),assert=require('assert/strict');const dir=process.argv[1];const before=require(path.join(dir,'driver-cash-payout-original-v1.js')),after=require(path.join(dir,'index.js'));
assert.deepEqual(Object.keys(before).sort(),Object.keys(after).sort());
(async()=>{const r=await after.financialAcceptanceHandler({action:'driver_cash_payout',accessToken:'not-a-jwt',body:{action:'READ'}});assert.equal(r.statusCode,401);console.log('PASS live-compatible wrapper exports and unauthenticated fail-closed');})().catch(e=>{console.error(e);process.exitCode=1});
"""
env=dict(__import__('os').environ);env.update(config.get('Environment',{}).get('Variables',{}));env['NODE_PATH']=str(R/'backend/wallet-service/node_modules')+':'+str(R/'node_modules');env['AWS_REGION']='us-east-1';env['DRIVER_CASH_PAYOUT_ENABLED']='true'
subprocess.run(['node','-e',code,str(financial)],env=env,check=True)
code="""
const assert=require('assert/strict'),path=require('path');const mod=require(path.join(process.argv[1],'_discount_review/central-staff/driver-cash-payouts.js'));
(async()=>{const actor={scope:{allRegions:true}},ctx={allowed:()=>true,enrolled:true,recent(){},claims:{},accessToken:'synthetic',lambda:{send:async()=>({Payload:Buffer.from(JSON.stringify({statusCode:503,code:'DRIVER_PAYOUT_UNAVAILABLE'}))})}};await assert.rejects(mod.route(ctx,actor,{action:'RECONCILE',driverId:'d'}),e=>e.status===503);await assert.rejects(mod.route(ctx,actor,{action:'ACK_RECEIPT',driverId:'d'}),e=>e.status===403);console.log('PASS actual staff adapter preserves uncertainty and rejects driver impersonation');})().catch(e=>{console.error(e);process.exitCode=1});
"""
subprocess.run(['node','-e',code,str(P/'staging-wizz-staff-service/unpacked')],env=env,check=True)
print('PASS package integrity; five isolated adapters; no business writes')
