"""Upload only hash-verified bootstrap files to the production Amplify app."""
import argparse,hashlib,io,json,os,zipfile,urllib.request
from pathlib import Path
from build_admin_frontend import PAGE_SCOPE

def archive(root,manifest):
 root=Path(root).resolve();expected=manifest['files']
 actual={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}
 if actual!=set(expected):raise ValueError('Bundle file set differs from reviewed manifest')
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for name,digest in expected.items():
   p=(root/name).resolve()
   if not p.is_relative_to(root) or p.is_symlink():raise ValueError('Unsafe bundle path')
   data=p.read_bytes()
   if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('Bundle hash mismatch: '+name)
   z.writestr(name,data)
 return out.getvalue()

def deploy(root,manifest_path,evidence_path):
 import boto3
 m=json.loads(Path(manifest_path).read_text());assert m['accountId']=='746727375268' and m.get('pageScope')==PAGE_SCOPE
 payload=archive(root,m)
 s=boto3.Session(profile_name='Wizz_prod_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='746727375268'
 stack=s.client('cloudformation').describe_stacks(StackName='wizz-production-admin-amplify')['Stacks'][0];assert stack['StackStatus'] in ['CREATE_COMPLETE','UPDATE_COMPLETE']
 outputs={x['OutputKey']:x['OutputValue'] for x in stack['Outputs']};a=s.client('amplify');app=a.get_app(appId=outputs['AppId'])['app'];assert app['name']=='wizz-centralplatform-production';assert not app.get('repository')
 r=a.create_deployment(appId=outputs['AppId'],branchName='production');req=urllib.request.Request(r['zipUploadUrl'],data=payload,method='PUT',headers={'Content-Type':'application/zip'})
 with urllib.request.urlopen(req,timeout=60) as response:assert response.status==200
 a.start_deployment(appId=outputs['AppId'],branchName='production',jobId=r['jobId'])
 evidence={'accountId':'746727375268','stack':'wizz-production-admin-amplify','appId':outputs['AppId'],'websiteUrl':outputs['WebsiteUrl'],'jobId':r['jobId'],'status':'DEPLOYING_BUNDLE','bundleSha256':hashlib.sha256(payload).hexdigest(),'fileCount':len(m['files']),'businessOperationsEnabled':False,'realLoginTested':False}
 Path(evidence_path).write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--bundle',required=True);p.add_argument('--manifest',required=True);p.add_argument('--evidence',required=True);args=p.parse_args();deploy(args.bundle,args.manifest,args.evidence)
