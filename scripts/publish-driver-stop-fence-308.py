from pathlib import Path
import json,zipfile,subprocess,copy,base64,hashlib
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/driver-vehicles-308';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];doc=R/'docs/driver-vehicle-publication-308.json'
def aws(*a):
 r=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(r)if r.strip()else{}
report=json.loads(doc.read_text());assert report['status']=='PUBLISHED_VERIFIED'and report['coreRefinement']['status']=='PUBLISHED_VERIFIED'
p=P/'DriversApi-staging';z=zipfile.ZipFile(p/'candidate-v2.zip');f=p/'stop-fence-candidate.js';f.write_bytes(z.read('lambda_driver_api_v2.js'))
subprocess.run(['node',str(R/'scripts/prepare-driver-stop-fence-308.cjs'),str(f),str(R.parent/'whizzDrivers-stg/backend/lambda_driver_api_v2.js')],check=True)
subprocess.run(['node','--check',str(f)],check=True);subprocess.run(['node',str(R/'scripts/test-driver-stop-fence-308.cjs'),str(f)],check=True)
with zipfile.ZipFile(p/'candidate-v3.zip','w',zipfile.ZIP_DEFLATED)as out:
 for info in z.infolist():out.writestr(copy.copy(info),f.read_bytes()if info.filename=='lambda_driver_api_v2.js'else z.read(info.filename))
target=p/'candidate-v3.zip';h=base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode();record=next(x for x in report['functions']if x['name']=='DriversApi-staging');cfg=aws('lambda','get-function-configuration','--function-name','DriversApi-staging');assert cfg['CodeSha256']==record['hash']
aws('lambda','update-function-code','--function-name','DriversApi-staging','--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(target));subprocess.run(B+['lambda','wait','function-updated-v2','--function-name','DriversApi-staging'],check=True)
after=aws('lambda','get-function-configuration','--function-name','DriversApi-staging');assert after['CodeSha256']==h and after['Environment']==cfg['Environment']and after['Role']==cfg['Role']
report['stopSearchFence']={'status':'PUBLISHED_VERIFIED','beforeHash':record['hash'],'hash':h,'changedFiles':['lambda_driver_api_v2.js'],'otherEntriesPreserved':True,'configurationPreserved':True,'regression':'normal stop, active order rejection and concurrent acceptance guarded'};record['hash']=h;doc.write_text(json.dumps(report,indent=2)+'\n');print('Published guarded stop for vehicle switching')
