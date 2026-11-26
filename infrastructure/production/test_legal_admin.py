import unittest,json,tempfile
from pathlib import Path
from prepare_legal_admin_api import build
from prepare_legal_admin import prepare,ROOT
class LegalAdminTests(unittest.TestCase):
 def test_isolated_data_permissions(self):
  statements=build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  data=[x for x in statements if any(a.startswith('dynamodb:') for a in x['Action'])]
  self.assertTrue(all('PlatformStaff' in json.dumps(x['Resource']) for x in data))
  self.assertTrue(all('Condition' in x for x in data));self.assertNotIn('Scan',json.dumps(data))
 def test_other_review_workflows_remain_in_production_mode(self):
  env=build()['Resources']['Function']['Properties']['Environment']['Variables'];self.assertEqual(env,{'ENVIRONMENT':'production','PLATFORM_ENVIRONMENT':'production'})
  with tempfile.TemporaryDirectory() as d:
   prepare(d);self.assertTrue((Path(d)/'write-workflow.js').is_file());self.assertEqual((Path(d)/'service/write-workflow.js').read_bytes(),(ROOT.parent.parent/'backend/staff-service/write-workflow.js').read_bytes())
 def test_source_reused_exactly(self):
  with tempfile.TemporaryDirectory() as d:
   prepare(d)
   for rel,source in [('service/customer-legal-documents-344.js','staff-service/customer-legal-documents-344.js'),('shared/customer-legal-contract-344.js','shared/customer-legal-contract-344.js')]:self.assertEqual((Path(d)/rel).read_bytes(),(ROOT.parent.parent/'backend'/source).read_bytes())
 def test_no_seed_or_publication_resource(self):
  t=build();self.assertFalse(any(x['Type'].startswith('Custom::') for x in t['Resources'].values()));self.assertEqual(t['Resources']['Function']['Condition'],'IsProductionAccount')
if __name__=='__main__':unittest.main()
