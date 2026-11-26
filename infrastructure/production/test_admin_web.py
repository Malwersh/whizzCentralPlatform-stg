import importlib.util,json,tempfile,unittest
from pathlib import Path
from prepare_admin_hosting import build
from preflight import validate_common
ROOT=Path(__file__).resolve().parent
class WebTests(unittest.TestCase):
 def test_isolated_account(self):
  t=build();self.assertEqual(validate_common(json.loads((ROOT/'environment.json').read_text()),json.dumps(t)),[])
 def test_private_versioned_bucket(self):
  t=build();b=t['Resources']['WebBucket']['Properties'];self.assertTrue(all(b['PublicAccessBlockConfiguration'].values()));self.assertEqual(b['VersioningConfiguration']['Status'],'Enabled');self.assertIn('cloudfront.amazonaws.com',json.dumps(t['Resources']['WebBucketPolicy']))
 def test_session_headers_and_no_caching(self):
  r=build()['Resources'];self.assertEqual(r['NoCache']['Properties']['CachePolicyConfig']['MaxTTL'],0);self.assertEqual(r['ApiRequestPolicy']['Properties']['OriginRequestPolicyConfig']['HeadersConfig'],{'HeaderBehavior':'allExcept','Headers':['Host']});d=r['Distribution']['Properties']['DistributionConfig'];self.assertEqual(d['Origins'][1]['OriginPath'],'/production');self.assertEqual(d['CacheBehaviors'][0]['PathPattern'],'/staff/*');self.assertNotIn('ResponsePagePath',json.dumps(d['CustomErrorResponses']))
 def test_no_external_script_permission(self):
  csp=build()['Resources']['SecurityHeaders']['Properties']['ResponseHeadersPolicyConfig']['SecurityHeadersConfig']['ContentSecurityPolicy']['ContentSecurityPolicy'];self.assertIn("script-src 'self';",csp);self.assertNotIn('unsafe-eval',csp);self.assertIn('https://cognito-idp.us-east-1.amazonaws.com',csp)
if __name__=='__main__':unittest.main()
