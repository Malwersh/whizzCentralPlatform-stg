"""Prepare isolated merchant onboarding administration; no business-data copy."""
from pathlib import Path
import shutil
ROOT=Path(__file__).resolve().parent
SOURCE=ROOT.parent.parent/'backend'
def prepare(destination):
 out=Path(destination);out.mkdir(parents=True,exist_ok=True)
 for name in ['api.cjs','index.cjs','service.cjs','config.cjs']:
  content=(ROOT/'merchant-onboarding'/name).read_text().replace("../../../backend/staff-service/onboarding-policy","./onboarding-policy")
  (out/name).write_text(content)
 for name in ['catalog.js','audit-trail.js','write-workflow.js']:shutil.copyfile(ROOT/'driver-review'/name,out/name)
 shutil.copyfile(SOURCE/'staff-service/onboarding-policy.js',out/'onboarding-policy.js')
 return out
