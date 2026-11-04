"""Revision-checked Staging code publication and separately owned read/fence policies. Never activates gates."""
import argparse, base64, datetime, hashlib, json, time
from pathlib import Path
ACCOUNT='699561669180';REGION='us-east-1';STACK='staging-finance-rollout-access-55'
ROOT=Path(__file__).resolve().parents[1]
def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True).encode()).hexdigest()
def closed(c):
    env=c.get('Environment',{}).get('Variables',{})
    for k,v in env.items():
        if k.startswith(('DISPATCH_','PINNED_','FINANCIAL_','COMMERCIAL_')) and k.endswith('_MODE'):
            if v!='OFF':raise ValueError('GATE_NOT_CLOSED')
    if env.get('DELIVERY_QUOTES_ENABLED','false')!='false' or env.get('DELIVERY_QUOTE_MODE','OFF')!='OFF' or env.get('FINANCE_ROLLOUT_CONFIG'):raise ValueError('SCOPE_OR_QUOTE_ALREADY_ACTIVE')
    return env

def run(audit,release,output,mode):
    import boto3
    audit,release,output=map(Path,[audit,release,output]);output.mkdir(mode=0o700,exist_ok=True)
    save=lambda n,v:(output/n).write_text(json.dumps(v,indent=2,default=str)+'\n')
    session=boto3.Session(profile_name='Wizz_stg_UserApp',region_name=REGION)
    if session.client('sts').get_caller_identity()['Account']!=ACCOUNT:raise ValueError('STAGING_ACCOUNT_REQUIRED')
    lam=session.client('lambda');cf=session.client('cloudformation');iam=session.client('iam')
    manifest=json.loads((release/'manifest.json').read_text());proof=json.loads((ROOT/'docs/finance-scoped-release-preparation-54.json').read_text())
    if manifest['account']!=ACCOUNT or manifest['region']!=REGION or len(manifest['functions'])!=21:raise ValueError('EXACT_MANIFEST_REQUIRED')
    if manifest['functions']!=proof['functions']:raise ValueError('REVIEWED_MANIFEST_CHANGED')
    proposals=json.loads(Path('/private/tmp/finance54-access-plan.json').read_text())
    if hashlib.sha256(Path('/private/tmp/finance54-access-plan.json').read_bytes()).hexdigest()!=proof['proposedPolicySha256']:raise ValueError('REVIEWED_POLICY_CHANGED')
    template=json.loads((ROOT/'backend/finance-rollout-access.staging.json').read_text());resources=template['Resources']
    if len(resources)!=4:raise ValueError('EXACT_FOUR_POLICIES_REQUIRED')
    for r,p in zip(resources.values(),proposals):
        if r['Type']!='AWS::IAM::Policy' or r['Properties']!={'PolicyName':p['policyName'],'PolicyDocument':p['policy'],'Roles':[p['role'].rsplit('/',1)[1]]}:raise ValueError('POLICY_OWNERSHIP_DRIFT')
    def configuration(f,candidate=False):
        c=lam.get_function_configuration(FunctionName=f['name']);env=closed(c)
        base=json.loads((audit/(f['name']+'.config.json')).read_text())
        if any(c.get(k)!=base.get(k) for k in ['FunctionArn','Handler','Runtime','Role','Timeout','MemorySize','Layers','VpcConfig','DeadLetterConfig','FileSystemConfigs','KMSKeyArn','Architectures','TracingConfig']) or c['State']!='Active' or c['LastUpdateStatus']!='Successful':raise ValueError('FUNCTION_BINDING_DRIFT:'+f['name'])
        if digest(env)!=f['environmentDigest']:raise ValueError('ENVIRONMENT_DRIFT:'+f['name'])
        if c['CodeSha256'] not in ([f['codeSha256'],f['candidateCodeSha256']] if candidate else [f['codeSha256']]):raise ValueError('LIVE_CODE_DRIFT:'+f['name'])
        if c['CodeSha256']==f['codeSha256'] and c['RevisionId']!=f['revisionId']:raise ValueError('REVISION_DRIFT:'+f['name'])
        return c
    # All functions must be stable and closed before infrastructure/code mutation.
    for f in manifest['functions']:configuration(f,candidate=mode in ['publish','verify'])
    if mode=='review-infrastructure':
        for p in proposals:
            try:iam.get_role_policy(RoleName=p['role'].rsplit('/',1)[1],PolicyName=p['policyName']);raise ValueError('POLICY_ALREADY_EXISTS')
            except iam.exceptions.NoSuchEntityException:pass
        name='finance55-reviewed-read-fences'
        r=cf.create_change_set(StackName=STACK,ChangeSetName=name,ChangeSetType='CREATE',TemplateBody=json.dumps(template),Capabilities=['CAPABILITY_NAMED_IAM'],Description='Four reviewed scoped reads and fences; gates remain closed')
        save('infrastructure-pending.json',{'changeSetArn':r['Id'],'stackArn':r['StackId'],'templateSha256':digest(template)})
        print(json.dumps({'changeSetCreated':True,'policiesApplied':False}));return
    state=json.loads((output/'infrastructure-pending.json').read_text());change=cf.describe_change_set(ChangeSetName=state['changeSetArn']);changes=change.get('Changes',[])
    if change['Status']!='CREATE_COMPLETE' or len(changes)!=4 or any(x['ResourceChange']['Action']!='Add' or x['ResourceChange']['ResourceType']!='AWS::IAM::Policy' or x['ResourceChange']['LogicalResourceId'] not in resources for x in changes) or state['templateSha256']!=digest(template):raise ValueError('CHANGE_SET_NOT_REVIEWABLE')
    if mode=='apply-infrastructure':
        if change['ExecutionStatus']!='AVAILABLE':raise ValueError('CHANGE_SET_NOT_AVAILABLE')
        # Recheck all bindings/gates immediately before executing the exact four-add plan.
        for f in manifest['functions']:configuration(f)
        cf.execute_change_set(ChangeSetName=state['changeSetArn']);save('infrastructure-execution.json',{'changeSetArn':state['changeSetArn'],'executedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'changes':changes,'activation':False})
        print(json.dumps({'fourPolicyChangeSetExecuted':True,'activation':False}));return
    stack=cf.describe_stacks(StackName=STACK)['Stacks'][0]
    if stack['StackStatus']!='CREATE_COMPLETE':raise ValueError('OWNED_INFRASTRUCTURE_NOT_COMPLETE')
    for p in proposals:
        actual=iam.get_role_policy(RoleName=p['role'].rsplit('/',1)[1],PolicyName=p['policyName'])['PolicyDocument']
        if actual!=p['policy']:raise ValueError('EFFECTIVE_POLICY_DIFFERS')
    if mode=='verify':
        rows=[]
        for f in manifest['functions']:
            c=configuration(f,True)
            if c['CodeSha256']!=f['candidateCodeSha256']:raise ValueError('FINAL_CODE_MISMATCH')
            rows.append({'name':f['name'],'codeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'environmentPreserved':True,'gatesClosed':True})
        save('verification.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'functions':rows,'stack':STACK,'policiesOwnedByCloudFormation':True,'activated':False});print(json.dumps({'verified':len(rows),'activated':False}));return
    if mode!='publish':raise ValueError('INVALID_MODE')
    effective=json.loads((output/'effective-access.json').read_text())
    if effective.get('proposedPoliciesIncluded') or len(effective['functions'])!=12 or not effective.get('reviewDependencyChecks') or any(c['decision']!='allowed' or c.get('missingContext') for r in effective['functions'] for c in r['checks']) or any(c['decision']!='allowed' or c.get('missingContext') for c in effective['reviewDependencyChecks']):raise ValueError('EFFECTIVE_IAM_VERIFICATION_REQUIRED')
    # Verify locally prepared bytes and the whole rollback set before first code update.
    for f in manifest['functions']:
        for suffix,expected in [('candidate',f['candidateCodeSha256']),('rollback',f['codeSha256'])]:
            if base64.b64encode(hashlib.sha256((release/(f['name']+'.'+suffix+'.zip')).read_bytes()).digest()).decode()!=expected:raise ValueError('ARCHIVE_CHANGED')
    existing=json.loads((output/'publication.json').read_text()) if (output/'publication.json').exists() else {'functions':[],'activated':False}
    rows={r['name']:r for r in existing['functions']}
    order=sorted(manifest['functions'],key=lambda f:(f['name']=='WizzUser-CreateOrder-staging',f['name']))
    for f in order:
        c=configuration(f,True)
        if c['CodeSha256']!=f['candidateCodeSha256']:
            result=lam.update_function_code(FunctionName=f['name'],RevisionId=c['RevisionId'],ZipFile=(release/(f['name']+'.candidate.zip')).read_bytes(),Publish=False)
            if result['CodeSha256']!=f['candidateCodeSha256']:raise ValueError('UPLOAD_HASH_MISMATCH')
            # Persist the accepted revision immediately; subsequent runs verify code/config CAS.
            save(f['name']+'.upload.json',{'revisionId':result['RevisionId'],'codeSha256':result['CodeSha256']})
            for attempt in range(90):
                time.sleep(2);c=lam.get_function_configuration(FunctionName=f['name'])
                if c['LastUpdateStatus']=='Successful':break
                if c['LastUpdateStatus']=='Failed':raise ValueError('LAMBDA_UPDATE_FAILED')
            c=configuration(f,True)
        if c['CodeSha256']!=f['candidateCodeSha256']:raise ValueError('PUBLICATION_HASH_MISMATCH')
        rows[f['name']]={'name':f['name'],'codeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'changed':f['codeSha256']!=f['candidateCodeSha256'],'environmentPreserved':True,'gatesClosed':True}
        save('publication.json',{'functions':list(rows.values()),'activated':False,'IAMStack':STACK});print(json.dumps({'name':f['name'],'verified':True,'gatesClosed':True}),flush=True)
    for p in output.glob('*.json'):p.chmod(0o600)
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('audit');p.add_argument('release');p.add_argument('output');p.add_argument('mode',choices=['review-infrastructure','apply-infrastructure','publish','verify']);a=p.parse_args()
    try:run(a.audit,a.release,a.output,a.mode)
    except Exception as e:print(type(e).__name__,str(e) if isinstance(e,ValueError) else 'STAGING_PUBLICATION_FAILED');raise SystemExit(1)
