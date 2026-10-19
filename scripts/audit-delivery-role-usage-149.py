"""Read-only role trust and Lambda usage check for proposed delivery IAM additions."""
import json,os,pathlib,subprocess,sys
OUT=pathlib.Path(sys.argv[1]);candidate=json.loads((OUT/'permission-candidates.json').read_text());roles={r['roleArn'] for r in candidate['roles']}
def aws(*args):
 p=subprocess.run(['aws',*args,'--profile','Wizz_stg_UserApp','--region','us-east-1','--output','json','--no-cli-pager','--cli-connect-timeout','8','--cli-read-timeout','25'],capture_output=True,text=True,env={**os.environ,'AWS_MAX_ATTEMPTS':'2'},timeout=60)
 if p.returncode:raise RuntimeError('AWS_ROLE_USAGE_READ_FAILED')
 return json.loads(p.stdout)
functions=aws('lambda','list-functions','--query','Functions[].{name:FunctionName,role:Role}')
rows=[]
for role in sorted(roles):
 r=aws('iam','get-role','--role-name',role.rsplit('/',1)[-1])['Role'];used=[f['name'] for f in functions if f['role']==role]
 row={'roleArn':role,'functions':sorted(used),'trust':r['AssumeRolePolicyDocument'],'permissionsBoundary':r.get('PermissionsBoundary')};rows.append(row)
report={'part':149,'readOnly':True,'applied':False,'roles':rows};p=OUT/'role-usage.private.json';p.write_text(json.dumps(report,indent=2)+'\n');os.chmod(p,0o600)
print(json.dumps({'readOnly':True,'roles':[{'functions':r['functions'],'boundaryPresent':bool(r['permissionsBoundary'])} for r in rows],'applied':False}))
