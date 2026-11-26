import json
import unittest
from prepare_customer_enrollment import build, artifacts, ROOT
from preflight import validate_common
class EnrollmentInfrastructureTests(unittest.TestCase):
 def test_account_and_artifact_isolation(self):
  manifest=json.loads((ROOT/'environment.json').read_text())
  for template in [build(),artifacts()]:self.assertEqual(validate_common(manifest,json.dumps(template)),[])
 def test_only_explicit_routes_and_no_debug_tracing(self):
  r=build()['Resources'];methods=[x['Properties'] for x in r.values() if x['Type']=='AWS::ApiGateway::Method'];self.assertEqual(len(methods),3)
  self.assertEqual(r['Function']['Properties']['Environment']['Variables']['OTP_ENABLED'],{'Ref':'OtpEnabled'})
  self.assertEqual(build()['Parameters']['OtpEnabled']['Default'],'false')
  self.assertFalse(r['Stage']['Properties']['MethodSettings'][0]['DataTraceEnabled'])
  for name in ['Send','Verify','Legal']:self.assertNotIn('*',r[name+'Invoke']['Properties']['SourceArn']['Fn::Sub'])
 def test_wallet_permissions_are_customer_only_and_cannot_update_balance(self):
  statements=build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  w=next(x for x in statements if 'table/wizz-production-Wallets' in json.dumps(x['Resource']))
  self.assertEqual(set(w['Action']),{'dynamodb:GetItem','dynamodb:PutItem'})
  self.assertEqual(w['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'],['WALLET#CUSTOMER#*'])
  self.assertTrue(all(x['Resource']!='*' for x in statements))
 def test_verification_can_guard_only_the_active_customer_otp_session(self):
  statements=build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  owns_check=[s for s in statements if 'table/wizz-production-CustomerPhoneAuth' in json.dumps(s['Resource']) and 'dynamodb:ConditionCheckItem' in s['Action']]
  self.assertEqual(len(owns_check),1)
  self.assertEqual(owns_check[0]['Action'],['dynamodb:ConditionCheckItem'])
  self.assertEqual(owns_check[0]['Condition'],{
   'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ACTIVE#*']},
   'Null':{'dynamodb:LeadingKeys':'false'}
  })
 def test_artifacts_private_versioned_retained_and_tls_only(self):
  r=artifacts()['Resources'];self.assertEqual(r['Artifacts']['DeletionPolicy'],'Retain');p=r['Artifacts']['Properties'];self.assertTrue(all(p['PublicAccessBlockConfiguration'].values()));self.assertEqual(p['VersioningConfiguration']['Status'],'Enabled');self.assertEqual(r['TlsOnly']['Properties']['PolicyDocument']['Statement'][0]['Effect'],'Deny')
