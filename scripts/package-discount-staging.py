#!/usr/bin/env python3
"""Build handler-compatible ZIP overlays from verified backups. No AWS operations."""
import argparse, hashlib, json, posixpath, re, zipfile
from pathlib import Path
TARGETS={
 'central-staff':'staging-wizz-staff-service',
 'merchant-products':'order-receiver-regional-staging-product-management-v4-sam',
 'merchant-discounts':'order-receiver-regional-staging-discount-management-v1-sam',
 'merchant-response-worker':'staging-merchant-response-99',
 **{'user-'+slug:'WizzUser-'+name+'-staging' for slug,name in [
 ('create-order','CreateOrder'),('cancel-order','CancelOrder'),('get-store-discounts','GetStoreDiscounts'),
 ('get-active-promo-codes','GetActivePromoCodes'),('validate-promo-code','ValidatePromoCode'),
 ('apply-promo-code','ApplyPromoCode'),('get-business-products','GetBusinessProducts')]}}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--backup',type=Path,required=True);p.add_argument('--candidates',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--only-function',choices=sorted(TARGETS.values()));a=p.parse_args()
 if not a.out.is_absolute() or a.out.exists():p.error('Use a fresh absolute output directory')
 backup=json.loads((a.backup/'manifest.json').read_text());candidates=json.loads((a.candidates/'manifest.json').read_text())
 if not backup.get('complete') or backup['account']!='699561669180' or candidates.get('failures'):raise RuntimeError('Complete backup and successful candidates required')
 a.out.mkdir(mode=0o700)
 report={'deployed':False,'featureFlagsChanged':False,'account':backup['account'],'region':backup['region'],'artifacts':[],'excludedLibraries':['merchant-pending-response']}
 for artifact,function in TARGETS.items():
  if a.only_function and function!=a.only_function:continue
  base=next(v for v in backup['backups'] if v['function']==function);candidate=next(v for v in candidates['artifacts'] if v['name']==artifact)
  content=Path(candidate['file']).read_bytes()
  if hashlib.sha256(content).hexdigest()!=candidate['sha256']:raise RuntimeError('Candidate hash mismatch: '+artifact)
  config=json.loads(Path(base['configuration']).read_text());handler,export=config['Handler'].rsplit('.',1);entry=handler+'.js'
  if export!='handler' or config['Runtime'] not in ['nodejs20.x','nodejs22.x']:raise RuntimeError('Unexpected handler/runtime')
  runtime='_discount_review/'+artifact+'/index.js';dest=a.out/(function+'.zip');bootstraps=[]
  with zipfile.ZipFile(base['archive']) as old:
   if old.testzip() is not None:raise RuntimeError('Corrupt backup ZIP')
   names=old.namelist()
   if entry not in names or runtime in names:raise RuntimeError('Unexpected archive layout')
   original=old.read(entry).decode()
   for relative in re.findall(r'require\(["\'](\.\.?/[^"\']+)["\']\)\.restoreFinanceRolloutConfig\(\)',original):
    file=posixpath.normpath(posixpath.join(posixpath.dirname(entry),relative))
    if file not in names:raise RuntimeError('Missing original bootstrap sidecar')
    bootstraps.append(relative)
   relative=posixpath.relpath(runtime,posixpath.dirname(entry) or '.')
   if not relative.startswith('.'):relative='./'+relative
   wrapper="'use strict';\n"+''.join('require('+json.dumps(b)+').restoreFinanceRolloutConfig();\n' for b in bootstraps)+'module.exports = require('+json.dumps(relative)+');\n'
   with zipfile.ZipFile(dest,'w',compression=zipfile.ZIP_DEFLATED) as new:
    for item in old.infolist():
     if item.filename!=entry:new.writestr(item,old.read(item.filename))
    new.writestr(entry,wrapper);new.writestr(runtime,content)
  dest.chmod(0o600)
  with zipfile.ZipFile(dest) as archive:
   if archive.testzip() is not None:raise RuntimeError('Corrupt packaged ZIP')
   uncompressed=sum(v.file_size for v in archive.infolist())
   if uncompressed>250*1024*1024:raise RuntimeError('Uncompressed deployment size exceeds Lambda limit')
  report['artifacts'].append({'function':function,'artifact':artifact,'handler':config['Handler'],'runtime':config['Runtime'],'zip':str(dest),
   'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'bytes':dest.stat().st_size,'requiresS3Upload':dest.stat().st_size>50*1024*1024,
   'preservedBootstraps':bootstraps,'expectedDeployedCodeSha256':base['codeSha256'],'expectedRevisionId':config['RevisionId'],'rollbackZip':base['archive']})
 (a.out/'deployment-plan.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'plan':str(a.out/'deployment-plan.json'),'packages':len(report['artifacts']),'deployed':False}))
if __name__=='__main__':main()
