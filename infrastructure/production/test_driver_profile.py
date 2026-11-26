import json,unittest
from pathlib import Path
from prepare_driver_profile import build
from prepare_driver_documents import build as storage
from preflight import validate_common
class ProfilePreparationTests(unittest.TestCase):
 def test_rules_reproducible_and_only_lifecycle_binding_changes(self):
  modules,evidence=build();root=Path(__file__).parent
  for name,text in modules.items():self.assertEqual((root/'driver-profile'/name).read_text(),text)
  self.assertEqual([e['module'] for e in evidence if e['sourceSha256']!=e['productionSha256']],['driver-lifecycle.js'])
 def test_private_retained_encrypted_storage(self):
  t=storage();self.assertEqual(validate_common(json.loads((Path(__file__).parent/'environment.json').read_text()),json.dumps(t)),[])
  b=t['Resources']['Documents']['Properties'];self.assertTrue(all(b['PublicAccessBlockConfiguration'].values()));self.assertEqual(b['VersioningConfiguration']['Status'],'Enabled');self.assertIn('BucketEncryption',b)
  self.assertEqual(t['Resources']['TlsOnly']['Properties']['PolicyDocument']['Statement'][0]['Effect'],'Deny')
if __name__=='__main__':unittest.main()
