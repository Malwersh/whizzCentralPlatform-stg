"""Read-only capture of existing Staging discount writers and rollback packages."""
import pathlib,json,subprocess,urllib.request,hashlib,base64,zipfile
R=pathlib.Path('/private/tmp/finance62');ROOT=pathlib.Path(__file__).resolve().parents[1]
def main():
 import boto3
 R.mkdir(mode=0o700,exist_ok=True);assert not (R/'inventory.json').exists(),'CAPTURE_EXISTS'
 c=json.loads(subprocess.check_output(['aws','configure','export-credentials','--profile','Wizz_stg_UserApp','--format','process']));s=boto3.Session(aws_access_key_id=c['AccessKeyId'],aws_secret_access_key=c['SecretAccessKey'],aws_session_token=c['SessionToken'],region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';lam=s.client('lambda');rows={}
 for kind,name in {'staff':'staging-wizz-staff-service','auth':'order-receiver-regional-staging-unified-auth-v4-sam','discount':'order-receiver-regional-staging-discount-management-v1-sam','writer':'WizzUser-CreateOrder-staging'}.items():
  v=lam.get_function(FunctionName=name);cfg=v['Configuration'];data=urllib.request.urlopen(v['Code']['Location'],timeout=60).read();assert base64.b64encode(hashlib.sha256(data).digest()).decode()==cfg['CodeSha256'];(R/(kind+'.zip')).write_bytes(data);(R/(kind+'.config.private.json')).write_text(json.dumps(cfg));rows[kind]={'name':name,'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'handler':cfg['Handler'],'role':cfg['Role']}
  with zipfile.ZipFile(R/(kind+'.zip')) as z:rows[kind]['relevantFiles']=[n for n in z.namelist() if not n.startswith('node_modules/') and any(k in n for k in ['discount','promotion','merchant-lifecycle','commercial','offer-eligibility','discount-reservation'])]
 a=s.client('amplify').list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert a['status']=='SUCCEED'
 cached=pathlib.Path('/private/tmp/merchant-branch-view-20261017/candidate.zip');evidence=json.loads((ROOT/'docs/merchant-branch-data-view-ui-2026-10-17.json').read_text());assert str(a['jobId'])=='72'
 data=cached.read_bytes();(R/'frontend.zip').write_bytes(data)
 with zipfile.ZipFile(cached) as z:
  for n in ['data-service.js','promotions.js','pages/promotions.html']:
   live=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n,timeout=30).read();assert live==z.read(n),'FRONTEND_DRIFT '+n
 rows['frontend']={'jobId':a['jobId'],'codeSha256':base64.b64encode(hashlib.sha256(data).digest()).decode(),'origin':'KNOWN_PUBLISHED_JOB72_ARCHIVE_WITH_HTTP_BYTE_CHECKS'}
 (R/'inventory.json').write_text(json.dumps(rows,indent=2));print(json.dumps(rows))
if __name__=='__main__':main()
