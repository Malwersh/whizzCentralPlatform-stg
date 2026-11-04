"""Deploy branch-manager sharing consent using scoped overlays over current Staging bundles."""
import pathlib,json,importlib.util,urllib.request,zipfile,io,copy,subprocess,hashlib,base64
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/sharing83');O.mkdir(exist_ok=True,mode=0o700)
sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 assert json.loads((O/'dynamo-test.json').read_text())['passed']
 assert 'All tests passed!' in pathlib.Path('/private/tmp/manager83-flutter-tests.log').read_text()
 for label,count in [('server',451),('wallet',685)]:assert 'fail 0' in pathlib.Path('/private/tmp/manager83-'+label+'-tests.log').read_text()
 s=m.session();l=s.client('lambda');cf=s.client('cloudformation');inventory={};result={'part':83,'functions':[],'financialGatesUnchanged':True,'actualHumanConsentSubmitted':False}
 names={'staff':'staging-wizz-staff-service','push':'wizzcentral-notifications-staging-pushSendMerchantOrder','worker':'staging-account-deletion-worker','expiry':'staging-account-deletion-financial-expiry','writer':'WizzUser-CreateOrder-staging'}
 for key,name in names.items():
  f=l.get_function(FunctionName=name);cfg=f['Configuration'];inventory[key]=cfg
  p=O/(key+'.config.private.json');p.write_text(json.dumps(cfg,default=str));p.chmod(0o600)
  (O/(key+'.base.zip')).write_bytes(urllib.request.urlopen(f['Code']['Location'],timeout=90).read())
 print(json.dumps({'captured':list(names)}),flush=True)
 # Existing embedded writer includes its own module copy: update both copies, preserving all other bytes.
 node="""const fs=require('fs'),cp=require('child_process'),assert=require('assert/strict'),ts=require('./backend/wallet-service/node_modules/typescript');const s=fs.readFileSync('scripts/overlay-financial-readers-63.cjs','utf8');const f=s.slice(s.indexOf('function moduleRange'),s.indexOf('const inv='));const wrapper=new Function('ts','assert',f+';return wrapper;')(ts,assert);const before=cp.execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))','/private/tmp/sharing83/writer.base.zip','functions/create-order/commercial-runtime.js'],{encoding:'utf8',maxBuffer:20000000});fs.writeFileSync('/private/tmp/sharing83/commercial-runtime.js',wrapper(before,'quote-runtime/orderCommercialSource.js',fs.readFileSync('backend/wallet-service/dist/orderCommercialSource.js','utf8')));const esbuild=require('./backend/wallet-service/node_modules/esbuild');const b=esbuild.buildSync({entryPoints:['backend/src/utils/commercial-sharing-push.js'],bundle:true,platform:'node',target:'node18',keepNames:true,external:['@aws-sdk/lib-dynamodb'],write:false,nodePaths:[process.cwd()+'/node_modules',process.cwd()+'/backend/node_modules']});fs.writeFileSync('/private/tmp/sharing83/commercial-sharing-push.js',b.outputFiles[0].contents);"""
 subprocess.run(['node','-e',node],cwd=R,check=True)
 changes={'staff':{n:R/'backend/staff-service'/n for n in ['commercial-management.js','commercial-party.js','commercial-events.js']},'push':{'src/utils/commercial-sharing-push.js':O/'commercial-sharing-push.js'},'worker':{'commercial-retention.js':R/'backend/account-deletion/commercial-retention.js'},'expiry':{'commercial-retention.js':R/'backend/account-deletion/commercial-retention.js'},'writer':{'functions/create-order/commercial-runtime.js':O/'commercial-runtime.js','functions/create-order/quote-runtime/orderCommercialSource.js':R/'backend/wallet-service/dist/orderCommercialSource.js'}}
 for key,files in changes.items():
  with zipfile.ZipFile(O/(key+'.base.zip')) as old,zipfile.ZipFile(O/(key+'.candidate.zip'),'w',zipfile.ZIP_DEFLATED) as out:
   for item in old.infolist():out.writestr(copy.copy(item),files[item.filename].read_bytes() if item.filename in files else old.read(item.filename))
   for n,p in files.items():
    if n not in old.namelist():out.writestr(n,p.read_bytes())
  with zipfile.ZipFile(O/(key+'.base.zip')) as old,zipfile.ZipFile(O/(key+'.candidate.zip')) as out:assert all(old.read(n)==out.read(n) for n in old.namelist() if n not in files)
 # Expand only scoped manager membership/policy reads on the existing notification role.
 stack='staging-commercial-sharing-notices-78';before=cf.describe_stacks(StackName=stack)['Stacks'][0]
 cf.update_stack(StackName=stack,TemplateBody=(R/'backend/commercial-notices.staging.json').read_text(),Parameters=[{'ParameterKey':p['ParameterKey'],'UsePreviousValue':True} for p in before['Parameters']],Capabilities=['CAPABILITY_NAMED_IAM'])
 cf.get_waiter('stack_update_complete').wait(StackName=stack,WaiterConfig={'Delay':2,'MaxAttempts':120});result['noticeReadPolicyUpdated']=True
 for key in ['writer','worker','expiry','push','staff']:
  cfg=inventory[key];current=l.get_function_configuration(FunctionName=names[key]);assert current['RevisionId']==cfg['RevisionId'],'LIVE_DRIFT '+key
  payload=(O/(key+'.candidate.zip')).read_bytes();l.update_function_code(FunctionName=names[key],RevisionId=cfg['RevisionId'],ZipFile=payload);l.get_waiter('function_updated_v2').wait(FunctionName=names[key],WaiterConfig={'Delay':2,'MaxAttempts':90});after=l.get_function_configuration(FunctionName=names[key]);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(payload).digest()).decode()
  for field in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig']:assert after.get(field)==cfg.get(field),(key,field)
  result['functions'].append({'name':names[key],'beforeSha256':cfg['CodeSha256'],'afterSha256':after['CodeSha256'],'changedFiles':list(changes[key]),'configurationPreserved':True});(O/'publication.json').write_text(json.dumps(result,indent=2));print(json.dumps({'published':key}),flush=True)
 for key,event in [('staff',{'httpMethod':'GET','path':'/staff/commercial','headers':{},'queryStringParameters':{}}),('staff',{'action':'commercial_owner','accessToken':'invalid','httpMethod':'POST','input':{}}),('push',{'action':'commercial_notice','pk':'INVALID','sk':'NOTICE#1'})]:
  r=l.invoke(FunctionName=names[key],Payload=json.dumps(event).encode());body=json.loads(r['Payload'].read());assert not r.get('FunctionError'),body;assert body=={'cancelled':True} if key=='push' else body.get('statusCode')==401,body
 result['runtimeAuthGuardsPassed']=True;(O/'publication.json').write_text(json.dumps(result,indent=2));print(json.dumps({'passed':True,'functions':len(result['functions']),'financialGatesUnchanged':True}))
if __name__=='__main__':main()
