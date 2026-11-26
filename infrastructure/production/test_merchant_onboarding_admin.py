import unittest,json,tempfile,subprocess
from pathlib import Path
from prepare_merchant_onboarding_admin_api import build
from prepare_merchant_onboarding_admin import prepare
class OnboardingAdminTests(unittest.TestCase):
 def test_permissions_are_scoped(self):
  statements=build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  data=[s for s in statements if any(a.startswith('dynamodb:') for a in s['Action'])]
  self.assertTrue(all('Condition' in s for s in data))
  self.assertTrue(all('PlatformStaff' in json.dumps(s['Resource']) for s in data))
  self.assertNotIn('DeleteItem',json.dumps(data));self.assertNotIn('Scan',json.dumps(data))
 def test_deployment_includes_both_routes(self):
  t=build();r=t['Resources']
  self.assertEqual(set(r['OnboardingDeployment']['DependsOn']),{'OnboardingGETMethod','ActionPOSTMethod'})
  self.assertEqual(r['Stage']['Properties']['DeploymentId'],{'Ref':'OnboardingDeployment'})
  self.assertEqual(r['Function']['Condition'],'IsProductionAccount')
 def test_preparation_resolves_local_imports(self):
  with tempfile.TemporaryDirectory() as d:
   prepare(d)
   for name in ['service.cjs','config.cjs']:
    text=(Path(d)/name).read_text();self.assertNotIn('../../../backend',text)
   self.assertTrue((Path(d)/'onboarding-policy.js').is_file())
 def test_prepared_permissions_load_runtime_dependencies(self):
  with tempfile.TemporaryDirectory() as d:
   prepare(d)
   subprocess.run(['node','-e',"const {allowed}=require('./catalog'); if(!allowed({status:'ACTIVE',roles:['bootstrap_admin']},'merchants.read'))process.exit(1)"],cwd=d,check=True,capture_output=True)
 def test_no_seed_or_registration_activation(self):
  self.assertFalse(any(r['Type'].startswith('Custom::') for r in build()['Resources'].values()))
if __name__=='__main__':unittest.main()
