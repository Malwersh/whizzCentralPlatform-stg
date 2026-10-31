"""Publish exact tested narrow overlays. No environment, role, API, table or gate changes."""
import pathlib,json,hashlib,base64,datetime,subprocess,argparse
import importlib.util
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path('/private/tmp/finance63')
spec=importlib.util.spec_from_file_location('capture63',ROOT/'scripts/capture-financial-readers-63.py');capture=importlib.util.module_from_spec(spec);spec.loader.exec_module(capture)
def main(verify=False):
 prep=json.loads((OUT/'preparation.json').read_text());proof=json.loads((OUT/'verification.json').read_text());assert proof['passed']
 for path,sha in proof['testedSources'].items():assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==sha,'SOURCE_CHANGED '+path
 for k,row in prep['packages'].items():assert base64.b64encode(hashlib.sha256((OUT/(k+'.candidate.zip')).read_bytes()).digest()).decode()==row['codeSha256']
 state=json.loads((OUT/'publication.json').read_text()) if (OUT/'publication.json').exists() else {'part':63,'environment':'Staging','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'functions':[],'activationPerformed':False,'iamChanges':False,'configurationChanges':False}
 lam=capture.session().client('lambda')
 def save():(OUT/'publication.json').write_text(json.dumps(state,indent=2))
 def check(k):
  cfg=lam.get_function_configuration(FunctionName=prep['base'][k]['name']);done=next((x for x in state['functions'] if x['name']==cfg['FunctionName']),None);before=json.loads((OUT/(k+'.config.private.json')).read_text());expected=done or prep['base'][k];assert cfg['CodeSha256']==expected['codeSha256'] and cfg['RevisionId']==expected['revisionId'],'LIVE_DRIFT '+k
  for f in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig']:assert cfg.get(f)==before.get(f),'CONFIG_DRIFT '+k+' '+f
  return cfg
 for k in prep['base']:check(k)
 if not verify:
  for k in ['driver','wave','timeout','quote','writer']:
   cfg=check(k)
   if any(x['name']==cfg['FunctionName'] for x in state['functions']):continue
   lam.update_function_code(FunctionName=cfg['FunctionName'],RevisionId=cfg['RevisionId'],ZipFile=(OUT/(k+'.candidate.zip')).read_bytes(),Publish=False);lam.get_waiter('function_updated_v2').wait(FunctionName=cfg['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':90});cfg=lam.get_function_configuration(FunctionName=cfg['FunctionName']);assert cfg['CodeSha256']==prep['packages'][k]['codeSha256'];state['functions'].append({'name':cfg['FunctionName'],'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'configurationPreserved':True});save();check(k);print(json.dumps({'published':k}),flush=True)
 else:
  assert len(state['functions'])==5
  events={'quote':{'httpMethod':'POST','headers':{},'body':'{}'},'writer':{'httpMethod':'POST','resource':'/orders/commercial-preview','headers':{},'body':'{"action":"preview_commercial"}'},'driver':{'accessToken':'no-credential','action':'accept','body':{}}};expected={'quote':503,'writer':409,'driver':409};checks={}
  for k,event in events.items():
   r=lam.invoke(FunctionName=prep['base'][k]['name'],Payload=json.dumps(event).encode());assert not r.get('FunctionError'),'RUNTIME_LOAD_ERROR '+k;b=json.loads(r['Payload'].read());assert b.get('statusCode')==expected[k],(k,b.get('statusCode'));checks[k]={'statusCode':b['statusCode'],'functionError':False}
  state['closedHostChecks']=checks;state['verifiedAtUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat();save();print(json.dumps({'functionsVerified':5,'closedHostChecks':checks,'activationPerformed':False}))
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('--verify',action='store_true');main(a.parse_args().verify)
