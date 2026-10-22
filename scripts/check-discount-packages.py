#!/usr/bin/env python3
"""Load packaged exports in network-blocked child processes. Never invokes handlers."""
import argparse,json,os,subprocess,tempfile,zipfile
from pathlib import Path

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--plan',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
 if a.out.exists():p.error('Use a fresh report path')
 plan=json.loads(a.plan.read_text());results=[]
 for entry in plan['artifacts']:
  with tempfile.TemporaryDirectory(prefix='wizz-handler-check-',dir='/private/tmp') as temp:
   root=Path(temp)
   with zipfile.ZipFile(entry['zip']) as z:
    for name in z.namelist():
     if 'node_modules' in Path(name).parts or name.endswith('/'):continue
     destination=(root/name).resolve()
     if not destination.is_relative_to(root):raise RuntimeError('Invalid archive path')
     destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(z.read(name))
   handler=root/(entry['handler'].rsplit('.',1)[0]+'.js')
   code="""const entry=process.argv[1];
const blocked=()=>{throw Error('NETWORK_DISABLED_FOR_PACKAGE_CHECK');};
require('node:net').Socket.prototype.connect=blocked;
require('node:http').request=blocked;require('node:https').request=blocked;global.fetch=blocked;
console.log=()=>{};console.warn=()=>{};console.error=()=>{};
try {const exports=require(entry);if(typeof exports.handler!=='function')throw Error('HANDLER_EXPORT_MISSING');process.exit(0);}
catch(e){process.stderr.write(String(e.name)+': '+String(e.message));process.exit(1);}
"""
   config=json.loads((Path(entry['rollbackZip']).parent/'configuration.json').read_text())
   env={**os.environ,**config.get('Environment',{}).get('Variables',{}),'AWS_EC2_METADATA_DISABLED':'true','AWS_REGION':'us-east-1'}
   checked=subprocess.run(['node','-e',code,str(handler)],env=env,text=True,capture_output=True,timeout=30)
   result={'function':entry['function'],'handlerLoadPassed':checked.returncode==0,'handlersInvoked':False,'networkEnabled':False}
   if checked.returncode:result['error']=checked.stderr[:1000]
   results.append(result)
 report={'deployed':False,'checks':results,'complete':all(r['handlerLoadPassed'] for r in results)}
 a.out.write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'report':str(a.out),'complete':report['complete'],'passed':sum(r['handlerLoadPassed'] for r in results),'total':len(results)}))
 for row in results:
  if not row['handlerLoadPassed']:print(json.dumps(row))
 return 0 if report['complete'] else 1
if __name__=='__main__':raise SystemExit(main())
