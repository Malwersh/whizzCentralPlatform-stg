import hashlib,io,json,tempfile,zipfile
from pathlib import Path
from prepare_legal_admin import prepare,ROOT

def bundle():
 files={}
 with tempfile.TemporaryDirectory() as d:
  prepare(d)
  for p in Path(d).rglob('*'):
   if p.is_file():files[str(p.relative_to(d))]=p.read_bytes()
 source=ROOT/'driver-review';lock=json.loads((source/'package-lock.json').read_text())
 for relative,m in lock['packages'].items():
  if not relative.startswith('node_modules/') or m.get('link'):continue
  p=source/relative/'package.json'
  if not p.is_file() or json.loads(p.read_text())['version']!=m['version']:raise ValueError('Locked dependency mismatch')
 for p in (source/'node_modules').rglob('*'):
  if p.is_file():files[str(p.relative_to(source))]=p.read_bytes()
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for name,data in sorted(files.items()):
   i=zipfile.ZipInfo(name,(2026,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;z.writestr(i,data)
 data=out.getvalue();return data,hashlib.sha256(data).hexdigest()
if __name__=='__main__':
 data,h=bundle();Path('/private/tmp/wizz-production-legal-admin.zip').write_bytes(data);print(h)
