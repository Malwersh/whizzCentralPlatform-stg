"""Reproducible publisher artifact using each service's locked dependency tree."""
import hashlib
import io
import json
import tempfile
import zipfile
from pathlib import Path
from prepare_region_management import ROOT, SOURCE, prepare

def bundle():
 files={}
 with tempfile.TemporaryDirectory() as directory:
  prepare(directory)
  for p in sorted(Path(directory).iterdir()):
   files['region-management/'+p.name]=p.read_bytes()
 for name in ['catalog.js','write-workflow.js','audit-trail.js']:
  files['driver-review/'+name]=(ROOT/'driver-review'/name).read_bytes()
 for source,prefix in [(SOURCE,'region-management/'),(ROOT/'driver-review','')]:
  lock=json.loads((source/'package-lock.json').read_text())
  tree=source/'node_modules'
  if not tree.is_dir():raise RuntimeError('Missing locked dependency tree: '+str(source))
  for relative,metadata in lock['packages'].items():
   if not relative.startswith('node_modules/') or metadata.get('link'):continue
   package=source/relative/'package.json'
   if not package.is_file() or json.loads(package.read_text())['version']!=metadata['version']:
    raise RuntimeError('Dependency mismatch: '+str(package))
  for p in sorted(tree.rglob('*')):
   if p.is_file():files[prefix+str(p.relative_to(source))]=p.read_bytes()
 data=io.BytesIO()
 with zipfile.ZipFile(data,'w',zipfile.ZIP_DEFLATED) as archive:
  for name,content in sorted(files.items()):
   item=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));item.compress_type=zipfile.ZIP_DEFLATED
   archive.writestr(item,content)
 value=data.getvalue();return value,hashlib.sha256(value).hexdigest()
if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
 data,sha=bundle();args.output.write_bytes(data);print(json.dumps({'bytes':len(data),'sha256':sha,'filesSource':'locked region and review dependency trees'}))
