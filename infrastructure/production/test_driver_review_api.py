import json,unittest
from pathlib import Path
from prepare_driver_review_api import build
from preflight import validate_common
class ReviewTests(unittest.TestCase):
 def test_production_account_disabled_and_routes(self):
  t=build();self.assertEqual(validate_common(json.loads((Path(__file__).parent/'environment.json').read_text()),json.dumps(t)),[])
  self.assertEqual(t['Resources']['Function']['Properties']['Environment']['Variables']['DRIVER_REVIEW_ENABLED'],{'Ref':'DriverReviewWritesEnabled'})
  self.assertEqual(t['Parameters']['DriverReviewWritesEnabled'],{'Type':'String','Default':'false','AllowedValues':['false','true']})
  self.assertEqual(sum(r['Type']=='AWS::ApiGateway::Method' for r in t['Resources'].values()),6)
  self.assertEqual(t['Resources']['DeletionMethod']['Properties']['HttpMethod'],'GET')
  self.assertEqual(t['Parameters']['DriverReviewReadEnabled']['Default'],'false')
  self.assertEqual(t['Resources']['Function']['Properties']['Environment']['Variables']['DRIVER_REVIEW_READ_ENABLED'],{'Ref':'DriverReviewReadEnabled'})
 def test_read_only_documents_and_no_financial_permissions(self):
  s=build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement'];text=json.dumps(s)
  for x in ['Wallet','s3:PutObject','s3:DeleteObject','s3:ListBucket','cognito-idp:AdminCreateUser','dynamodb:DeleteItem']:self.assertNotIn(x,text)
  self.assertIn('s3:GetObjectVersion',text);self.assertIn('EMPLOYEE#*',text);self.assertIn('AUDIT',text)
  metrics=[x for x in s if x['Resource'].get('Fn::Sub','').endswith('/wizz-production-DriverPerformanceSnapshots')]
  self.assertEqual(len(metrics),1)
  self.assertEqual(metrics[0]['Action'],'dynamodb:GetItem')
  self.assertEqual(metrics[0]['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'],['DRIVER#*','CONTROL'])
 def test_dependencies_are_exact_versions(self):
  p=json.loads((Path(__file__).parent/'driver-review/package.json').read_text());self.assertTrue(all(v[0].isdigit() and not any(c in v for c in '^~*') for v in p['dependencies'].values()))
if __name__=='__main__':unittest.main()
