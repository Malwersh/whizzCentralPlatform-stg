from pathlib import Path
import json,subprocess,zipfile,copy,base64,hashlib
R=Path.cwd();P=R/'backend/.tmp/admin-dispatch-retry-298';Q=P/'WaveSystem_StartWave';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];n='WaveSystem_StartWave'
def aws(*a):return json.loads(subprocess.check_output(B+list(a)))
expected=next(x['hash']for x in json.load(open(P/'sdk-packages.json'))if x['name']==n);cfg=aws('lambda','get-function-configuration','--function-name',n);assert cfg['CodeSha256']==expected
z=zipfile.ZipFile(Q/'candidate.zip');s=z.read('dispatch-cycle-runtime.js').decode();needle=' return require("./admin-retry-runtime-298.js").createStagingPinnedFinancialRunner(...args);'
addition=" if(first?.cognito&&typeof first.cognito.send==='function'){const sdk=require('@aws-sdk/client-cognito-identity-provider'),client=first.cognito;args[0]={...args[0],cognito:{send(command){const type=command?.constructor?.name?.replace(/\\d+$/,'');if(!['AdminGetUserCommand','GetUserCommand','AdminListGroupsForUserCommand'].includes(type)||typeof sdk[type]!=='function')throw Error('ADMIN_RETRY_COGNITO_COMMAND_INVALID');return client.send(command instanceof sdk[type]?command:new sdk[type](command.input));}}};}"
assert s.count(needle)==1;s=s.replace(needle,addition+needle);local=Q/'cognito-runtime.js';local.write_text(s);subprocess.run(['node','--check',str(local)],check=True)
# Keep the exact executable delegate for an offline strict-client test.
(Q/'candidate-files/dispatch-cycle-runtime.js').write_text(s)
p=Q/'cognito-candidate.zip'
with zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED)as out:
 for info in z.infolist():out.writestr(copy.copy(info),s.encode()if info.filename=='dispatch-cycle-runtime.js'else z.read(info.filename))
aws('lambda','update-function-code','--function-name',n,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(p));subprocess.run(B+['lambda','wait','function-updated-v2','--function-name',n],check=True);after=aws('lambda','get-function-configuration','--function-name',n);sha=base64.b64encode(hashlib.sha256(p.read_bytes()).digest()).decode();assert after['CodeSha256']==sha and after['Environment']==cfg['Environment'];(R/'docs/admin-dispatch-retry-cognito-boundary-298.json').write_text(json.dumps({'status':'PUBLISHED_VERIFIED','function':n,'beforeHash':expected,'hash':sha,'changedFiles':['dispatch-cycle-runtime.js'],'configurationPreserved':True,'iamChanged':False,'businessDataWrittenDirectly':False},indent=2)+'\n');print('Cognito bridge published',flush=True)
