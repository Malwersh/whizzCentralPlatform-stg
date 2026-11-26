from pathlib import Path
import subprocess,json,zipfile,copy,hashlib,base64,concurrent.futures
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/driver-vehicles-308';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];doc=R/'docs/driver-vehicle-publication-308.json'
def aws(*a):
 r=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(r)if r.strip()else{}
report=json.loads(doc.read_text());assert report['stopSearchFence']['status']=='PUBLISHED_VERIFIED'
assert 'ℹ pass 64'in Path('/private/tmp/vehicles-308-package-tests-final.log').read_text()
def publish(row):
 name=row['name'];p=P/name;base=p/('candidate-v3.zip'if name=='DriversApi-staging'else'candidate-v2.zip');z=zipfile.ZipFile(base);changes={}
 for filename in ['driver-vehicles-runtime-308.js','driver-vehicles-308.js','driver-vehicles-core-308.js']:
  if filename in z.namelist():changes[filename]=(P/'driver-vehicles-runtime-308.js').read_bytes()if filename=='driver-vehicles-runtime-308.js'else(R/'backend/shared/driver-vehicles-308.js').read_bytes()
 target=p/'candidate-final.zip'
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 h=base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode();cfg=aws('lambda','get-function-configuration','--function-name',name);assert cfg['CodeSha256']==row['hash'],'LIVE_DRIFT '+name
 aws('lambda','update-function-code','--function-name',name,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(target));subprocess.run(B+['lambda','wait','function-updated-v2','--function-name',name],check=True)
 after=aws('lambda','get-function-configuration','--function-name',name);assert after['CodeSha256']==h and after['Environment']==cfg['Environment']and after['Role']==cfg['Role'];print('Final verification',name,flush=True)
 return {'name':name,'beforeHash':row['hash'],'hash':h,'changedFiles':list(changes),'configurationPreserved':True,'otherEntriesPreserved':True}
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:results=list(pool.map(publish,report['functions']))
for row in report['functions']:row['hash']=next(x['hash']for x in results if x['name']==row['name'])
report['legacyInspectionFence']={'status':'PUBLISHED_VERIFIED','reason':'Reject pending pre-cutover vehicle-unbound legacy offers before reserving a hold','tests':64,'functions':results};doc.write_text(json.dumps(report,indent=2)+'\n')
