"""Simulate captured principal policies plus proposed inline documents. No writes."""
import json,os,pathlib,subprocess,sys,time
OUT=pathlib.Path(sys.argv[1]);baseline=json.loads((OUT/'simulations.private.json').read_text());candidate=json.loads((OUT/'permission-candidates.json').read_text());assert candidate['applied'] is False
policies={r['roleArn']:r['policy'] for r in candidate['roles']};groups={}
for r in baseline['results']:
 assert r.get('decision') in ['allowed','implicitDeny'] and not r.get('missingContext')
 groups.setdefault((r['role'],r['resource'],r['leadingKey']),[]).append(r)
rows=[]
for (role,resource,leading),cases in groups.items():
 req={'PolicySourceArn':role,'ActionNames':sorted(set(r['action'] for r in cases)),'ResourceArns':[resource],'ContextEntries':[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[leading]}]}
 if role in policies:req['PolicyInputList']=[json.dumps(policies[role])]
 for attempt in range(4):
  p=subprocess.run(['aws','iam','simulate-principal-policy','--cli-input-json',json.dumps(req),'--profile','Wizz_stg_UserApp','--region','us-east-1','--output','json','--no-cli-pager','--cli-connect-timeout','8','--cli-read-timeout','20'],capture_output=True,text=True,env={**os.environ,'AWS_MAX_ATTEMPTS':'2'},timeout=30)
  if not p.returncode or 'Throttl' not in p.stderr:break
  time.sleep(attempt+1)
 if p.returncode:
  rows += [{**r,'candidateError':'ACCESS_DENIED' if 'AccessDenied' in p.stderr else 'SIMULATION_FAILED'} for r in cases]
 else:
  byAction={r['EvalActionName']:r for r in json.loads(p.stdout)['EvaluationResults']}
  for case in cases:
   result=byAction[case['action']];rows.append({**case,'candidateDecision':result['EvalDecision'],'candidateMissingContext':result.get('MissingContextValues',[])})
 time.sleep(0.6)
report={'part':149,'readOnly':True,'applied':False,'candidateSimulation':True,'results':rows,'limitation':'Principal-policy simulation does not replace service/resource policy, endpoint policy, SCP or actual staging integration verification.'}
p=OUT/'candidate-simulations.private.json';p.write_text(json.dumps(report,indent=2)+'\n');os.chmod(p,0o600)
allowed=sum(r.get('candidateDecision')=='allowed' and not r.get('candidateMissingContext') for r in rows)
print(json.dumps({'cases':len(rows),'candidateAllowed':allowed,'candidateUnresolved':len(rows)-allowed,'applied':False}))
if allowed!=len(rows):sys.exit(1)
