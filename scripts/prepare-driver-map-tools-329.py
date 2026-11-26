from pathlib import Path
import json,zipfile,copy,hashlib,base64,urllib.request
R=Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';P=Path('/private/tmp/driver-map-tools-329')
report=[]
for label,name,base,entry in [('driver','DriversApi-staging','base.zip','lambda_driver_api_v2.js'),('staff','staging-wizz-staff-service','staff-base.zip','_discount_review/central-staff/index.js')]:
 with zipfile.ZipFile(P/base)as old:
  changes={};source=old.read(entry).decode()
  if label=='driver':
   current=(D/'backend/lambda_driver_api_v2.js').read_text();a=current.index("    if ((path === '/driver/map-activity'");b=current.index("    if ((path === '/driver/demand-forecast'",a);needle="    if ((path === '/driver/demand-forecast'";assert source.count(needle)==1;source=source.replace(needle,current[a:b]+needle,1)
   needle='    await enrichStoresWithHotScores(stores);';assert source.count(needle)==1;source=source.replace(needle,'    // Current activity comes only from the authenticated map-activity route.\n    for (const store of stores) {store.is_hot=false;store.hot_score=0;store.waiting_orders_count=null;}')
   a=source.index('async function getMapData(');i=source.index('      success: true,',a)+len('      success: true,');source=source[:i]+"\n      map_tools: await require('./driver-map-settings-329').readPolicy(dynamodb,GetCommand).catch(()=>null),"+source[i:]
   changes.update({'driver-map-activity.js':(D/'backend/driver-map-activity.js').read_bytes(),'driver-map-settings-329.js':(R/'backend/shared/driver-map-settings-329.js').read_bytes()})
  else:
   needle='    if (path === "/staff/settings/delivery-operations"';assert source.count(needle)==1;insert="  if(path==='/staff/settings/driver-map'||path.startsWith('/staff/settings/driver-map/'))return response(200,await require('./driver-map-settings-329').route({db,table,employee,guard,audit,requirePermission,recent,claims,allowed,enrolled,settingsRoute:settingsRoutes.route},actor,method,path,input));\n";source=source.replace(needle,insert+needle,1)
   changes.update({'_discount_review/central-staff/driver-map-settings-329.js':(R/'backend/staff-service/driver-map-settings-329.js').read_bytes(),'_discount_review/shared/driver-map-settings-329.js':(R/'backend/shared/driver-map-settings-329.js').read_bytes()})
  changes[entry]=source.encode()
  with zipfile.ZipFile(P/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for ent in old.infolist():out.writestr(copy.copy(ent),changes.get(ent.filename,old.read(ent.filename)))
   for k,v in changes.items():
    if k not in old.namelist():out.writestr(k,v)
  with zipfile.ZipFile(P/(label+'-candidate.zip'))as out:assert all(old.read(k)==out.read(k)for k in old.namelist()if k not in changes)
  cfg=json.loads((P/('config.private.json'if label=='driver'else'staff-config.private.json')).read_text());report.append({'label':label,'name':name,'previousHash':cfg['CodeSha256'],'candidateHash':base64.b64encode(hashlib.sha256((P/(label+'-candidate.zip')).read_bytes()).digest()).decode(),'changedFiles':list(changes),'unrelatedEntriesPreserved':True})
latest=json.loads((P/'hosting-latest.json').read_text());assert str(latest['jobId'])=='215'and latest['status']=='SUCCEED'
base=Path('/private/tmp/driver-cash-payout-v1/hosting-candidate.zip')
with zipfile.ZipFile(base)as old:
 name='pages/settings.html';source=old.read(name);assert urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+name+'?base=329',timeout=30).read()==source
 source=source.decode();assert 'driver-map-settings'not in source;source=source.replace('<section id="delivery-operations">','<section id="driver-map-settings"></section><section id="delivery-operations">').replace('</body>','<script src="../settings-driver-map-329.js?v=329"></script></body>');assert 'id="driver-map-settings"'in source
 changes={name:source.encode(),'settings-driver-map-329.js':(R/'frontend/settings-driver-map-329.js').read_bytes()}
 with zipfile.ZipFile(P/'hosting-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for ent in old.infolist():out.writestr(copy.copy(ent),changes.get(ent.filename,old.read(ent.filename)))
  out.writestr('settings-driver-map-329.js',changes['settings-driver-map-329.js'])
 with zipfile.ZipFile(P/'hosting-candidate.zip')as out:assert all(old.read(k)==out.read(k)for k in old.namelist()if k not in changes)
(P/'packages.json').write_text(json.dumps(report,indent=2));(P/'hosting-review.json').write_text(json.dumps({'baseJob':'215','changedFiles':list(changes),'unrelatedEntriesPreserved':True,'sha256':hashlib.sha256((P/'hosting-candidate.zip').read_bytes()).hexdigest()},indent=2));print('PASS isolated packages, settings overlay; other published files preserved')
