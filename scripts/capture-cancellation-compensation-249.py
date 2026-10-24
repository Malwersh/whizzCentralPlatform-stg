"""Capture current Staging code and private configuration; no business writes."""
import boto3,json,pathlib,urllib.request
R=pathlib.Path(__file__).resolve().parents[1];P=R/'backend/.tmp/cancellation-compensation-249';P.mkdir(parents=True,exist_ok=True);s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');inventory={}
for key,name in [('financial','staging-driver-financial-accept'),('staff','staging-wizz-staff-service')]:
 r=l.get_function(FunctionName=name);inventory[key]=r['Configuration'];urllib.request.urlretrieve(r['Code']['Location'],P/(key+'.zip'))
p=P/'inventory.private.json';p.write_text(json.dumps(inventory,default=str));p.chmod(0o600);print('Captured two packages; no business action executed.')
