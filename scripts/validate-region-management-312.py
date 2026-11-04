from pathlib import Path
import subprocess,json,hashlib,re,os
R=Path(__file__).resolve().parents[1];tmp=Path('/private/tmp')
def run(name,cmd):
 log=tmp/('regions-312-'+name+'.log')
 with log.open('w')as out:subprocess.run(cmd,cwd=R,stdout=out,stderr=subprocess.STDOUT,check=True)
 print('PASS',name,flush=True);return log.read_text()
subprocess.run(['node','scripts/build-region-management-312.cjs'],cwd=R,check=True)
tests=run('service-all-tests',['node','--test',*map(str,(R/'backend/region-management/test').glob('*.test.cjs'))]);count=int(re.search(r'ℹ pass (\d+)',tests).group(1))
for name,script in [('staff-handler-tests','test-region-staff-handler-312.cjs'),('customer-reader-tests','test-customer-region-reader-312.cjs'),('browser-tests','test-region-management-ui-312.cjs')]:run(name,['node','scripts/'+script])
# The shared operational resolver is unchanged but its acceptance contract must
# remain intact for all existing quote/driver readers.
run('coverage-regression',['node','--test','backend/wallet-service/test/region-coverage.test.cjs'])
paths=[*sorted((R/'backend/region-management').glob('*.js')),*sorted((R/'backend/region-management/test').glob('*.cjs')),R/'frontend/region-management-312.js',R/'frontend/region-management-312.css',R/'frontend/region-geometry-worker-312.js',R/'frontend/region-geometry-runtime-312.js',R/'frontend/pages/regions.html',R/'frontend/assets/js/rbac.js',R/'cloudformation/region-management-312.yaml',R/'cloudformation/region-management-assets-312.yaml',R/'../wizzuser-stg/backend/src/lambdas/find-region-by-coordinates.js',R/'../wizzuser-stg/backend/src/utils/region-coverage-runtime-312.js',R/'../wizzuser-stg/backend/src/utils/business-metadata-utils.js',R/'../wizzuser-stg/backend/src/lambdas/auto-populate-business-metadata.js',R/'../wizzuser-stg/backend/template.yaml']
rows=[{'file':os.path.relpath(p,R),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in paths]
report={'status':'PASS','serviceTests':count,'checks':['actualStaffHandlerAndSDK','actualCustomerHandlerAndSDK','realLeafletBrowser','existingCoverageRegression'],'sourceFiles':rows,'businessDataMutated':False,'artifactHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in (R/'backend/.tmp/regions-312').glob('region-management-*-312.js')}}
(R/'docs/region-management-validation-312.json').write_text(json.dumps(report,indent=2)+'\n')
print('Region management validation manifest complete',flush=True)
