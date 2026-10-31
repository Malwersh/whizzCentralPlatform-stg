#!/usr/bin/env python3
"""Read-only deployment backup. Configuration/policies are stored locally, never printed."""
import argparse, base64, hashlib, json, subprocess, urllib.request
from pathlib import Path
from datetime import datetime, timezone

def aws(profile,*args):
    r=subprocess.run(['aws',*args,'--profile',profile,'--region','us-east-1','--output','json','--no-cli-pager'],capture_output=True,text=True,timeout=60)
    if r.returncode: raise RuntimeError(r.stderr.strip())
    return json.loads(r.stdout)
def save(path,value):
    path.write_text(json.dumps(value,indent=2)+'\n');path.chmod(0o600)
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--profile',required=True);p.add_argument('--inventory',required=True,type=Path);p.add_argument('--out',required=True,type=Path);a=p.parse_args()
    if not a.out.is_absolute() or a.out.exists():p.error('--out must be a fresh absolute directory')
    source=json.loads(a.inventory.read_text());identity=aws(a.profile,'sts','get-caller-identity')
    if identity.get('Account')!='699561669180' or source.get('account')!=identity['Account'] or source.get('region')!='us-east-1':raise RuntimeError('Account/region mismatch')
    a.out.mkdir(mode=0o700,parents=True)
    report={'createdAt':datetime.now(timezone.utc).isoformat(),'account':identity['Account'],'region':'us-east-1','readOnly':True,'backups':[],'errors':[]}
    for entry in source['functions']:
        name=entry['FunctionName'];directory=a.out/name;directory.mkdir(mode=0o700)
        try:
            deployed=aws(a.profile,'lambda','get-function','--function-name',name)
            config=deployed['Configuration'];code=deployed['Code']
            if code.get('RepositoryType')!='S3':raise RuntimeError('Unsupported code repository')
            with urllib.request.urlopen(code['Location'],timeout=60) as response:data=response.read()
            digest=base64.b64encode(hashlib.sha256(data).digest()).decode()
            if digest!=config['CodeSha256']:raise RuntimeError('Downloaded code checksum mismatch')
            archive=directory/'deployed.zip';archive.write_bytes(data);archive.chmod(0o600)
            save(directory/'configuration.json',config)
            save(directory/'aliases.json',aws(a.profile,'lambda','list-aliases','--function-name',name))
            save(directory/'resource-policy.json',{'note':'Resource policy unchanged by the prepared code rollout; not queried'})
            role=config['Role'].rsplit('/',1)[-1]
            save(directory/'role.json',aws(a.profile,'iam','get-role','--role-name',role))
            inline=aws(a.profile,'iam','list-role-policies','--role-name',role)
            inline_docs=[aws(a.profile,'iam','get-role-policy','--role-name',role,'--policy-name',n) for n in inline.get('PolicyNames',[])]
            attached=aws(a.profile,'iam','list-attached-role-policies','--role-name',role)
            managed=[]
            for policy in attached.get('AttachedPolicies',[]):
                meta=aws(a.profile,'iam','get-policy','--policy-arn',policy['PolicyArn'])
                version=aws(a.profile,'iam','get-policy-version','--policy-arn',policy['PolicyArn'],'--version-id',meta['Policy']['DefaultVersionId'])
                managed.append({'metadata':meta,'version':version})
            save(directory/'iam-policies.json',{'inline':inline_docs,'managed':managed})
            report['backups'].append({'function':name,'codeSha256':digest,'roleName':role,'archive':str(archive),'configuration':str(directory/'configuration.json'),'iamPolicies':str(directory/'iam-policies.json')})
            save(a.out/'manifest.json',report)
            print(json.dumps({'backedUp':name,'checksumVerified':True}),flush=True)
        except Exception as error:
            report['errors'].append({'function':name,'message':str(error).split('https://')[0]})
            save(a.out/'manifest.json',report)
            print(json.dumps({'failed':name}),flush=True)
    report['complete']=len(report['backups'])==len(source['functions']) and not report['errors'];save(a.out/'manifest.json',report)
    print(json.dumps({'manifest':str(a.out/'manifest.json'),'complete':report['complete']}))
    return 0 if report['complete'] else 1
if __name__=='__main__':raise SystemExit(main())
