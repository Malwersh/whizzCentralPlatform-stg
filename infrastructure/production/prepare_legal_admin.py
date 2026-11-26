"""Prepare production legal administrator without copying or publishing customer data."""
from pathlib import Path
import shutil
ROOT=Path(__file__).resolve().parent
SOURCE=ROOT.parent.parent/'backend'
def prepare(destination):
 out=Path(destination);out.mkdir(parents=True,exist_ok=True)
 for name in ['api.cjs','index.cjs']:shutil.copyfile(ROOT/'legal-admin'/name,out/name)
 for name in ['catalog.js','audit-trail.js']:shutil.copyfile(ROOT/'driver-review'/name,out/name)
 for directory in ['service','shared']:(out/directory).mkdir(exist_ok=True)
 for name in ['customer-legal-documents-344.js','write-workflow.js']:shutil.copyfile(SOURCE/'staff-service'/name,out/'service'/name)
 for name in ['customer-legal-contract-344.js','customer-legal-defaults-344.json','driver-legal-defaults-344.json','merchant-legal-defaults-344.json']:shutil.copyfile(SOURCE/'shared'/name,out/'shared'/name)
 shutil.copyfile(SOURCE/'staff-service'/'write-workflow.js',out/'write-workflow.js')
 # The legal adapter explicitly permits authorized self-publication.
 # Keep the environment and all other review workflows in production mode.
 return out
if __name__=='__main__':
 import sys
 prepare(sys.argv[1])
