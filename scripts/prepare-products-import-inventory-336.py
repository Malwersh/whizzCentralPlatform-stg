"""Read-only AWS package backup and local build. No credentials/environment secrets in repository artifacts."""
from pathlib import Path
import boto3,json,urllib.request,zipfile,subprocess
R=Path(__file__).resolve().parents[1];O=Path('/private/tmp/products-336-release');O.mkdir(exist_ok=True)
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');configs={}
for name in ['order-receiver-regional-staging-product-management-v4-sam','order-receiver-regional-staging-image-upload-v1-sam','WizzUser-CreateOrder-staging','WizzUser-GetBusinessProducts-staging','order-receiver-regional-staging-discount-management-v1-sam']:
 response=l.get_function(FunctionName=name);c=response['Configuration'];configs[name]={k:c.get(k) for k in ['FunctionName','Role','Handler','Runtime','CodeSha256','RevisionId','LastModified']};folder=O/name;folder.mkdir(exist_ok=True);archive=folder/'before.zip';urllib.request.urlretrieve(response['Code']['Location'],archive);target=folder/'package';target.mkdir(exist_ok=True)
 with zipfile.ZipFile(archive) as z:
  for member in z.namelist():assert (target/member).resolve().is_relative_to(target.resolve()),'UNSAFE_PACKAGE_PATH'
  z.extractall(target)
Path('/private/tmp/products-336-runtime-before.json').write_text(json.dumps(configs,indent=2))
subprocess.run(['node',str(R/'scripts/build-products-runtime-336.cjs')],cwd=R,check=True)
print('Staging packages backed up; candidates built. No deployment performed.')
