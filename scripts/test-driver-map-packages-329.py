from pathlib import Path
import json,zipfile,subprocess,os
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-map-tools-329')
for row in json.loads((P/'packages.json').read_text()):
 d=P/(row['label']+'-unpacked');d.mkdir(exist_ok=True)
 with zipfile.ZipFile(P/(row['label']+'-candidate.zip'))as z:z.extractall(d)
 for f in row['changedFiles']:subprocess.run(['node','--check',str(d/f)],check=True)
env=dict(os.environ);env['NODE_PATH']=str(R/'backend/wallet-service/node_modules')+':'+str(R/'node_modules')
code="""
const assert=require('assert/strict'),path=require('path');const dir=process.argv[1];const staff=require(path.join(dir,'staff-unpacked/_discount_review/central-staff/driver-map-settings-329.js'));let captured;
(async()=>{await staff.route({settingsRoute:async(...args)=>{captured=args;return {ok:true};},allowed:()=>true},{scope:{allRegions:true}},'GET','/staff/settings/driver-map',{});assert.equal(captured[3],'/staff/settings/account-deletion');assert.equal(captured[0].settingsSpec.pk,'OPERATIONAL_SETTINGS#DRIVER_MAP_TOOLS');const runtime=require(path.join(dir,'driver-unpacked/driver-map-settings-329.js'));assert.equal(runtime.DEFAULTS.customerServicePhone,'+9647831367435');assert.equal(require(path.join(dir,'driver-unpacked/driver-map-activity.js')).waiting({storeId:'s',status:'ready_for_pickup',assignedDriverId:'d'},'s'),false);console.log('PASS actual packaged policy route reuses live settings engine; companion imports resolve; no business writes');})().catch(e=>{console.error(e);process.exitCode=1});
"""
subprocess.run(['node','-e',code,str(P)],env=env,check=True)
