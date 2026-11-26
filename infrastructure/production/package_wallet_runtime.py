"""Bundle the tested wallet entry point with its installed dependencies."""
import hashlib,io,subprocess,tempfile,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def bundle(entry='src/index.ts'):
 service=ROOT/'backend/wallet-service'
 with tempfile.TemporaryDirectory() as d:
  target=Path(d)/'index.js'
  subprocess.run([str(service/'node_modules/.bin/esbuild'),entry,'--bundle','--platform=node','--target=node22','--keep-names','--outfile='+str(target)],cwd=service,check=True)
  output=io.BytesIO()
  with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
   info=zipfile.ZipInfo('index.js',(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,target.read_bytes())
  data=output.getvalue();return data,hashlib.sha256(data).hexdigest()
if __name__=='__main__':
 data,digest=bundle();Path('/private/tmp/wizz-production-wallet-runtime.zip').write_bytes(data);print(digest)
