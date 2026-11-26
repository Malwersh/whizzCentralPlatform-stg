import unittest,json,hashlib
from prepare_merchant_enrollment import build,package

class MerchantEnrollmentTests(unittest.TestCase):
 def test_isolated_and_disabled(self):
  t=build();r=t['Resources'];self.assertEqual(t['Conditions']['IsProductionAccount']['Fn::Equals'][1],{'Ref':'ExpectedAccountId'})
  self.assertEqual(t['Parameters']['ExpectedAccountId']['AllowedValues'],['746727375268'])
  self.assertEqual(r['Function']['Properties']['Environment']['Variables']['MERCHANT_ENROLLMENT_ENABLED'],{'Ref':'EnrollmentEnabled'})
  self.assertNotIn('staging',json.dumps(t));self.assertNotIn('699561669180',json.dumps(t))
 def test_bootstrap_routes_only(self):
  r=build()['Resources'];methods=[x['Properties'] for x in r.values() if x['Type']=='AWS::ApiGateway::Method']
  self.assertEqual(len(methods),3);self.assertEqual(sorted(x['HttpMethod'] for x in methods),['GET','POST','POST'])
  self.assertEqual(set(x['AuthorizationType'] for x in methods),{'NONE'})
  self.assertFalse(r['Stage']['Properties']['MethodSettings'][0]['DataTraceEnabled'])
 def test_no_financial_or_destructive_access(self):
  p=build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  actions=[a for x in p for a in x['Action']]
  self.assertFalse(any(a.endswith((':Scan',':DeleteItem',':AdminDeleteUser',':AdminUpdateUserAttributes')) or '*' in a for a in actions))
  self.assertNotIn('Wallet',json.dumps(p));self.assertNotIn('MerchantPlatform',json.dumps(p))
  for x in p:self.assertNotEqual(x['Resource'],'*')
 def test_artifact_pinned_reproducibly(self):
  self.assertEqual(hashlib.sha256(package()).digest(),hashlib.sha256(package()).digest())
  code=build()['Resources']['Function']['Properties']['Code'];self.assertEqual(code['S3ObjectVersion'],{'Ref':'ArtifactVersion'})
  self.assertEqual(code['S3Key'],{'Ref':'ArtifactKey'})
if __name__=='__main__':unittest.main()
