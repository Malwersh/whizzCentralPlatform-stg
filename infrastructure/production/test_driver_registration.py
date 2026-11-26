import unittest,json
from prepare_driver_registration import build,ROOT
class DriverRegistrationTests(unittest.TestCase):
 def test_reproducible_package_and_explicit_dependencies(self):
  code,r=build();self.assertEqual(code,(ROOT/'phone-auth/driver-registration.bundle.cjs').read_text());self.assertFalse(r['otpEnabled']);self.assertFalse(r['walletServiceReady'])
  for forbidden in ['staging','031857856164','699561669180',"InvocationType:'Event'"]:self.assertNotIn(forbidden,code)
  self.assertIn('TransactItems:[lifecycleCondition(sub)',code)
  self.assertIn('await requireWallet(',code)
