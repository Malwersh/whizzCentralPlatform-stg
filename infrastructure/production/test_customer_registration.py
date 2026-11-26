import unittest
from prepare_customer_registration import build, ROOT
class CustomerRegistrationPackageTests(unittest.TestCase):
    def test_reproducible_isolated_package(self):
        code, report = build()
        self.assertEqual(code, (ROOT/'phone-auth/customer-registration.bundle.cjs').read_text())
        for forbidden in ['staging', '031857856164', '699561669180', '146152253137']:
            self.assertNotIn(forbidden, code)
        self.assertFalse(report['otpEnabled'])
        self.assertEqual(report['status'], 'LOCAL_ARTIFACT_NOT_DEPLOYED')
