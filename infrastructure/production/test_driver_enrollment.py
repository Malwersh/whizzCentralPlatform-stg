import json,unittest
from pathlib import Path
from prepare_driver_enrollment import build
from preflight import validate_common
class DriverEnrollmentTests(unittest.TestCase):
 def test_isolation_and_disabled_gates(self):
  t=build();self.assertEqual(validate_common(json.loads((Path(__file__).parent/'environment.json').read_text()),json.dumps(t)),[])
  e=t['Resources']['Function']['Properties']['Environment']['Variables'];self.assertEqual(e['OTP_ENABLED'],{'Ref':'OtpEnabled'});self.assertEqual(e['WALLET_BINDING_READY'],{'Ref':'WalletBindingReady'});self.assertEqual(t['Parameters']['WalletBindingReady']['Default'],'false')
 def test_wallet_is_read_only_and_only_creator_invoked(self):
  statements=build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  w=next(x for x in statements if 'Wallets' in json.dumps(x['Resource']));self.assertEqual(w['Action'],['dynamodb:GetItem'])
  inv=next(x for x in statements if 'lambda:InvokeFunction' in x['Action']);self.assertTrue(json.dumps(inv['Resource']).endswith('wizz-production-wallet-creation-trigger"}'))
if __name__=='__main__':unittest.main()
