from pathlib import Path
import json,zipfile,subprocess,copy,hashlib,base64
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/driver-vehicles-308';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];doc=R/'docs/driver-vehicle-publication-308.json'
def aws(*a):
 r=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(r)if r.strip()else{}
report=json.loads(doc.read_text());assert report['legacyInspectionFence']['status']=='PUBLISHED_VERIFIED'
p=P/'DriversApi-staging';z=zipfile.ZipFile(p/'candidate-final.zip');f=p/'registration-candidate.js';f.write_bytes(z.read('lambda_driver_api_v2.js'))
subprocess.run(['node',str(R/'scripts/prepare-driver-stop-fence-308.cjs'),str(f),str(R.parent/'whizzDrivers-stg/backend/lambda_driver_api_v2.js'),'updateDriverProfile'],check=True)
subprocess.run(['node','--check',str(f)],check=True);subprocess.run(['node',str(R/'scripts/test-driver-vehicle-profile-308.cjs'),str(f)],check=True)
with zipfile.ZipFile(p/'candidate-registration.zip','w',zipfile.ZIP_DEFLATED)as out:
 for info in z.infolist():out.writestr(copy.copy(info),f.read_bytes()if info.filename=='lambda_driver_api_v2.js'else z.read(info.filename))
target=p/'candidate-registration.zip';h=base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode();row=next(x for x in report['functions']if x['name']=='DriversApi-staging');cfg=aws('lambda','get-function-configuration','--function-name','DriversApi-staging');assert cfg['CodeSha256']==row['hash']
aws('lambda','update-function-code','--function-name','DriversApi-staging','--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(target));subprocess.run(B+['lambda','wait','function-updated-v2','--function-name','DriversApi-staging'],check=True)
after=aws('lambda','get-function-configuration','--function-name','DriversApi-staging');assert after['CodeSha256']==h and after['Environment']==cfg['Environment']and after['Role']==cfg['Role'];report['registrationPlate']={'status':'PUBLISHED_VERIFIED','beforeHash':row['hash'],'hash':h,'changedFiles':['lambda_driver_api_v2.js'],'otherEntriesPreserved':True,'configurationPreserved':True};row['hash']=h;doc.write_text(json.dumps(report,indent=2)+'\n');print('Verified initial registration plate persistence')
