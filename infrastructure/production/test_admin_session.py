import json,unittest
from pathlib import Path
from prepare_admin_session import build
from preflight import validate_common
class AdminSessionTests(unittest.TestCase):
 def test_account_and_disabled_gate(self):
  t=build();self.assertEqual(validate_common(json.loads((Path(__file__).parent/'environment.json').read_text()),json.dumps(t)),[])
  self.assertEqual(t['Parameters']['AdminSessionEnabled']['Default'],'false')
  self.assertEqual(t['Resources']['Function']['Properties']['Environment']['Variables']['ADMIN_SESSION_ENABLED'],{'Ref':'AdminSessionEnabled'})
 def test_minimal_routes_and_permissions(self):
  t=build();self.assertEqual(sum(v['Type']=='AWS::ApiGateway::Method' for v in t['Resources'].values()),2)
  text=json.dumps(t['Resources']['Role']);
  for s in ['Wallet','Drivers','s3:','AdminCreateUser','AdminSetUser','dynamodb:Scan','dynamodb:DeleteItem']:self.assertNotIn(s,text)
  self.assertIn('EMPLOYEE#*',text);self.assertIn('AUDIT',text)
if __name__=='__main__':unittest.main()
