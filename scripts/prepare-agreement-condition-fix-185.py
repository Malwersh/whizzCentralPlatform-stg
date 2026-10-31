"""Prepare a narrow correction to DynamoDB condition metadata, preserving every predicate."""
import pathlib,json,boto3,urllib.request,zipfile,copy,hashlib,base64,subprocess
p=pathlib.Path('/private/tmp/agreement-commit-185');p.mkdir(exist_ok=True,mode=0o700);s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');r=l.get_function(FunctionName='WizzUser-CreateOrder-staging');c=r['Configuration'];b=urllib.request.urlopen(r['Code']['Location']).read();assert base64.b64encode(hashlib.sha256(b).digest()).decode()==c['CodeSha256'];f=p/'config.private.json';f.write_text(json.dumps(c,default=str));f.chmod(0o600);(p/'before.zip').write_bytes(b);z=zipfile.ZipFile(p/'before.zip');name='agreement-runtime182.js';source=z.read(name).decode();(p/'before.js').write_text(source);(p/'agreement-sdk182.js').write_bytes(z.read('agreement-sdk182.js'))
for field,variable in [('Names','names'),('Values','values')]:
 old=f'prior.ExpressionAttribute{field} = {{ ...prior.ExpressionAttribute{field}, ...{variable} }};';assert source.count(old)==1
 new=f'const merged{field} = {{ ...prior.ExpressionAttribute{field}, ...{variable} }}; if(Object.keys(merged{field}).length) prior.ExpressionAttribute{field}=merged{field}; else delete prior.ExpressionAttribute{field};';source=source.replace(old,new)
(p/'after.js').write_text(source);subprocess.run(['node','--check',str(p/'after.js')],check=True)
with zipfile.ZipFile(p/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
 for entry in z.infolist():out.writestr(copy.copy(entry),source.encode() if entry.filename==name else z.read(entry.filename))
with zipfile.ZipFile(p/'candidate.zip') as out:assert all(out.read(n)==z.read(n) for n in z.namelist() if n!=name)
print('Prepared condition metadata correction; every other ZIP entry unchanged.')
