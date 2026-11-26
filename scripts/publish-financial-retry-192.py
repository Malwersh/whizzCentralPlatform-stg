"""Publish reviewed code-only overlays, preserve all Lambda configuration values."""
import pathlib,json,subprocess,hashlib,base64,datetime
p=pathlib.Path('/private/tmp/financial-retry-192');rows=json.loads((p/'candidates.json').read_text());done=[]
def aws(*args):return json.loads(subprocess.check_output(['aws',*args,'--profile','Wizz_stg_UserApp','--region','us-east-1','--output','json']))
for row in rows:
 name=row['name'];before=aws('lambda','get-function-configuration','--function-name',name);original=json.loads((p/(name+'.private.json')).read_text());assert before['CodeSha256']==row['baseCodeSha256'];assert before['Environment']['Variables']==original['Environment']['Variables'];assert before['Role']==original['Role'];candidate=pathlib.Path(row['candidate']);assert base64.b64encode(hashlib.sha256(candidate.read_bytes()).digest()).decode()==row['candidateCodeSha256']
 aws('lambda','update-function-code','--function-name',name,'--revision-id',before['RevisionId'],'--zip-file','fileb://'+str(candidate))
 subprocess.run(['aws','lambda','wait','function-updated-v2','--function-name',name,'--profile','Wizz_stg_UserApp','--region','us-east-1'],check=True)
 after=aws('lambda','get-function-configuration','--function-name',name);assert after['CodeSha256']==row['candidateCodeSha256'];assert after['Environment']['Variables']==original['Environment']['Variables'];assert all(after.get(k)==before.get(k) for k in ['Role','Handler','MemorySize','Timeout','Runtime','Architectures','VpcConfig','Layers']);done.append({'name':name,'codeSha256':after['CodeSha256'],'configurationPreserved':True,'otherEntriesIdentical':True,'changedFiles':row['changedFiles']});(p/'code-published.json').write_text(json.dumps(done,indent=2)+'\n')
print(json.dumps({'published':done,'financialDataWrites':0,'admissionConfigChanged':False}))
