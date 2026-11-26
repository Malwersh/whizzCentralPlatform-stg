"""Capture current Staging packages and prepare isolated staff-management overlays."""
import boto3,pathlib,urllib.request,json,zipfile,subprocess
R=pathlib.Path(__file__).resolve().parents[1];P=R/'backend/.tmp/order-management-247';P.mkdir(parents=True,exist_ok=True);l=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda');inventory={}
for key,name in [('staff','staging-wizz-staff-service'),('financial','staging-driver-financial-accept')]:
 r=l.get_function(FunctionName=name);inventory[key]=r['Configuration'];urllib.request.urlretrieve(r['Code']['Location'],P/(key+'.zip'))
f=P/'inventory.private.json';f.write_text(json.dumps(inventory,default=str));f.chmod(0o600)
with zipfile.ZipFile(P/'staff.zip')as z:s=z.read('_discount_review/central-staff/index.js').decode()
assert "path==='/staff/order-management'" not in s,'ALREADY_INSTALLED';needle='    if (path === "/staff/order-exceptions"';assert s.count(needle)==1;s=s.replace(needle,"    if(path==='/staff/order-management')return response(200,await require(process.env.LAMBDA_TASK_ROOT+'/order-management.js').route({allowed,enrolled,recent,claims,query:event.queryStringParameters,accessToken:token},actor,method,path,input));\n"+needle);(P/'staff-candidate.js').write_text(s)
with zipfile.ZipFile(P/'financial.zip')as z:s=z.read('index.js').decode()
assert 'previousStaffManagementHandler' not in s,'ALREADY_INSTALLED';s+="\nconst previousStaffManagementHandler=module.exports.financialAcceptanceHandler;\nmodule.exports={...module.exports,financialAcceptanceHandler:async(event,...args)=>event?.action==='staff_order_management'?require('./staff-order-management-runtime.js').handler(event):previousStaffManagementHandler(event,...args)};\n";(P/'financial-candidate.js').write_text(s)
subprocess.run([str(R/'backend/wallet-service/node_modules/.bin/esbuild'),'backend/wallet-service/src/staffOrderManagement.ts','--bundle','--platform=node','--target=node22','--keep-names','--outfile='+str(P/'staff-order-management-runtime.js')],cwd=R,check=True)
for name in ['staff-candidate.js','financial-candidate.js','staff-order-management-runtime.js']:subprocess.run(['node','--check',str(P/name)],check=True)
print('Prepared bounded code overlays; no business action executed.')
