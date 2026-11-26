import json,unittest
from pathlib import Path
from prepare_driver_wallet import build
from preflight import validate_common
class DriverWalletTests(unittest.TestCase):
 def test_account_and_resource_isolation(self):
  root=Path(__file__).parent;t=build();self.assertEqual(validate_common(json.loads((root/'environment.json').read_text()),json.dumps(t)),[])
  self.assertEqual(len(t['Resources']),3)
  self.assertEqual(t['Parameters']['WalletCreationEnabled']['Default'],'false')
  self.assertEqual(t['Resources']['Function']['Properties']['Environment']['Variables']['WALLET_CREATION_ENABLED'],{'Ref':'WalletCreationEnabled'})
 def test_only_driver_wallet_creation_and_lifecycle_reads(self):
  statements=build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  actions={a for s in statements for a in s['Action']}
  self.assertFalse(actions & {'dynamodb:UpdateItem','dynamodb:DeleteItem','dynamodb:Scan','lambda:InvokeFunction'})
  wallet=next(s for s in statements if 'dynamodb:PutItem' in s['Action'])
  self.assertEqual(wallet['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'],['WALLET#DRIVER#*'])
if __name__=='__main__':unittest.main()
