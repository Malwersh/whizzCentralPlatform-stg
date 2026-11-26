"""Reproducible Lambda bundle; builds locally without AWS access or personal data."""
import hashlib,io,json,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def bundle():
 files={}
 for name in ['index.cjs','session-api.cjs']:
  files['admin-session/'+name]=(ROOT/'admin-session'/name).read_bytes()
 for name in ['catalog.js','write-workflow.js','audit-trail.js']:
  files['driver-review/'+name]=(ROOT/'driver-review'/name).read_bytes()
 files['index.js']=b"exports.handler=require('./admin-session/index.cjs').handler;\n"
 # Reuse the exact locked dependency tree already tested for the review service.
 source=ROOT/'driver-review';lock=json.loads((source/'package-lock.json').read_text())
 if not (source/'node_modules/aws-jwt-verify/package.json').is_file():raise RuntimeError('Install the locked review dependencies with npm ci before packaging')
 for p in sorted((source/'node_modules').rglob('*')):
  if p.is_file():files[str(p.relative_to(source))]=p.read_bytes()
 for module in ['aws-jwt-verify','@aws-sdk/client-cognito-identity-provider','@aws-sdk/client-dynamodb','@aws-sdk/lib-dynamodb']:
  actual=json.loads((source/'node_modules'/module/'package.json').read_text())['version']
  if actual!=lock['packages']['node_modules/'+module]['version']:raise RuntimeError('Dependency version mismatch: '+module)
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for name,data in sorted(files.items()):
   entry=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;z.writestr(entry,data)
 data=out.getvalue();return data,hashlib.sha256(data).hexdigest()
if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);args=p.parse_args();data,sha=bundle();args.output.write_bytes(data);print(json.dumps({'sha256':sha,'bytes':len(data),'output':str(args.output)}))
