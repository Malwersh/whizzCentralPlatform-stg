"""Pin tested enrollment rules; adapt lifecycle table without copying user data."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
SOURCE=ROOT.parents[2]/'whizzDrivers-stg/backend'
NAMES=['registration-regions.js','driver-vehicles-308.js','driver_eligibility.js','driver-lifecycle.js','customer-legal-contract-344.js','customer-legal-defaults-344.json','driver-legal-defaults-344.json','merchant-legal-defaults-344.json']
def build():
 modules={};evidence=[]
 for name in NAMES:
  raw=(SOURCE/name).read_text();text=raw
  if name=='driver-lifecycle.js':
   assert raw.count('staging-AccountDeletion')==3
   text=raw.replace('staging-AccountDeletion','wizz-production-AccountDeletion')
  assert 'staging' not in text,name
  modules[name]=text;evidence.append({'module':name,'sourceSha256':hashlib.sha256(raw.encode()).hexdigest(),'productionSha256':hashlib.sha256(text.encode()).hexdigest(),'adaptation':'Production lifecycle table only' if name=='driver-lifecycle.js' else 'UNCHANGED'})
 return modules,evidence
if __name__=='__main__':
 modules,evidence=build();target=ROOT/'driver-profile';target.mkdir(exist_ok=True)
 for name,text in modules.items():(target/name).write_text(text)
 report={'accountId':'746727375268','status':'LOCAL_RULES_PREPARED_NOT_DEPLOYED','sourceEvidence':evidence,'dataCopied':False,'activationRequirements':['Private document bucket and ownership-scoped upload API','Authenticated profile API with production pool authorizer','Production published legal documents','Reviewed production regions and effective region projection','Administrative document/vehicle/region approval APIs','Full upload/profile/approval lifecycle acceptance']}
 (ROOT/'driver-profile-readiness.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
