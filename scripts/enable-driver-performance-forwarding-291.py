from pathlib import Path
import json,subprocess,sys
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-performance-projection-291');BASE=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(BASE+list(a));return json.loads(raw)if raw.strip()else{}
assert '--approved-staging-infrastructure'in sys.argv
name='WaveSystem_CreateDispatchJob';cfg=aws('lambda','get-function-configuration','--function-name',name);publication=json.loads((R/'docs/driver-performance-projection-publication-291.json').read_text());expected=next(x['hash']for x in publication['functions']if x['name']==name);assert cfg['CodeSha256']==expected
sim=aws('iam','simulate-principal-policy','--policy-source-arn',cfg['Role'],'--action-names','lambda:InvokeFunction','--resource-arns','arn:aws:lambda:us-east-1:699561669180:function:staging-driver-performance-collector');assert all(x['EvalDecision']=='allowed'for x in sim['EvaluationResults'])
env={'Variables':{**cfg['Environment']['Variables'],'DRIVER_PERFORMANCE_FORWARD_ENABLED':'true'}};f=P/'forward-env.private.json';f.write_text(json.dumps(env));f.chmod(0o600);aws('lambda','update-function-configuration','--function-name',name,'--revision-id',cfg['RevisionId'],'--environment','file://'+str(f));subprocess.check_call(BASE+['lambda','wait','function-updated-v2','--function-name',name]);after=aws('lambda','get-function-configuration','--function-name',name);assert after['CodeSha256']==expected
assert {k:v for k,v in after['Environment']['Variables'].items()if k!='DRIVER_PERFORMANCE_FORWARD_ENABLED'}=={k:v for k,v in cfg['Environment']['Variables'].items()if k!='DRIVER_PERFORMANCE_FORWARD_ENABLED'}
publication['forwardingEnabled']=True;publication['orderReaderAdded']=False;(R/'docs/driver-performance-projection-publication-291.json').write_text(json.dumps(publication,indent=2)+'\n');print('ORDER_FORWARD_ENABLED_WITH_EXACT_INVOKE_PERMISSION',flush=True)
