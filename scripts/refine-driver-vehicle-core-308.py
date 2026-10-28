from pathlib import Path
import json,zipfile,copy,hashlib,base64,subprocess
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/driver-vehicles-308';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];doc=R/'docs/driver-vehicle-publication-308.json'
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw)if raw.strip()else{}
report=json.loads(doc.read_text());assert report['status']=='PUBLISHED_VERIFIED'
assert 'ℹ pass 63'in Path('/private/tmp/vehicles-308-package-tests-v2.log').read_text()
assert 'ℹ pass 27'in Path('/private/tmp/vehicles-308-service-tests.log').read_text()
report['coreRefinement']={'status':'PUBLISHING','reason':'Strict malformed flags and explicit account suspension/reactivation consistency','functions':[]};doc.write_text(json.dumps(report,indent=2)+'\n')
for row in report['functions']:
 name=row['name'];p=P/name;z=zipfile.ZipFile(p/'candidate.zip');changes={}
 for filename in ['driver-vehicles-runtime-308.js','driver-vehicles-308.js','driver-vehicles-core-308.js']:
  if filename in z.namelist():changes[filename]=(P/'driver-vehicles-runtime-308.js').read_bytes()if filename=='driver-vehicles-runtime-308.js'else(R/'backend/shared/driver-vehicles-308.js').read_bytes()
 target=p/'candidate-v2.zip'
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 afterHash=base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode();cfg=aws('lambda','get-function-configuration','--function-name',name);assert cfg['CodeSha256']==row['hash'],'LIVE_DRIFT '+name
 aws('lambda','update-function-code','--function-name',name,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(target));subprocess.run(B+['lambda','wait','function-updated-v2','--function-name',name],check=True)
 after=aws('lambda','get-function-configuration','--function-name',name);assert after['CodeSha256']==afterHash and after['Environment']==cfg['Environment']and after['Role']==cfg['Role']
 report['coreRefinement']['functions'].append({'name':name,'beforeHash':row['hash'],'hash':afterHash,'changedFiles':list(changes),'configurationPreserved':True});row['hash']=afterHash;doc.write_text(json.dumps(report,indent=2)+'\n');print('Verified final core',name,flush=True)
report['coreRefinement']['status']='PUBLISHED_VERIFIED';doc.write_text(json.dumps(report,indent=2)+'\n')
