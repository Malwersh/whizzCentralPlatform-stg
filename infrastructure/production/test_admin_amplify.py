import json,unittest
from prepare_admin_amplify import build
from preflight import validate_common
from pathlib import Path
class AmplifyTests(unittest.TestCase):
 def test_account_guard(self):
  self.assertEqual(validate_common(json.loads((Path(__file__).parent/'environment.json').read_text()),json.dumps(build())),[])
 def test_no_git_or_role_or_data(self):
  r=build()['Resources'];self.assertEqual({x['Type'] for x in r.values()},{'AWS::Amplify::App','AWS::Amplify::Branch'});p=r['AdminApp']['Properties'];self.assertNotIn('Repository',p);self.assertNotIn('IAMServiceRole',p)
 def test_reviewed_deploy_only(self):
  p=build()['Resources']['ProductionBranch']['Properties'];self.assertFalse(p['EnableAutoBuild']);self.assertFalse(p['EnablePerformanceMode']);self.assertEqual(p['Stage'],'PRODUCTION')
 def test_exact_api_routes_no_spa_fallback(self):
  r=build()['Resources']['AdminApp']['Properties']['CustomRules'];self.assertEqual([x['Source'] for x in r],['/staff/pickup-issues','/staff/merchants/staff-policy','/staff/merchants/staff-policy/history','/staff/merchants/staff-policy/save','/staff/settlement-schedules','/staff/settlement-schedules/branches','/staff/order-cancellation','/staff/merchants/agreements','/staff/merchants/directory','/staff/merchants/branch','/staff/merchants/applications','/staff/merchants/applications/review','/staff/merchants/application-asset','/staff/home-layout/slides','/staff/home-layout','/staff/home-layout/options','/staff/home-layout/draft','/staff/home-layout/publish','/staff/home-layout/rollback','/staff/drivers/<driverId>/performance','/staff/drivers/<driverId>/quality','/staff/merchants/onboarding','/staff/merchants/onboarding/<action>','/staff/settings/legal-documents/<audience>','/staff/settings/legal-documents/<audience>/<action>','/staff/settings/legal-documents/<audience>/version/<revision>','/staff/regions/manage','/staff/regions/manage/history/<regionId>','/staff/regions/manage/jobs/<jobId>','/staff/regions/manage/validate','/staff/regions/manage/validate-plan','/staff/regions/manage/draft','/staff/regions/manage/discard','/staff/regions/manage/cancel','/staff/regions/manage/publish','/staff/me','/staff/enrollment/finish','/staff/drivers','/staff/drivers/<driverId>/vehicles','/staff/drivers/<driverId>/documents/view','/']);self.assertTrue(all('/production/staff/' in x['Target'] for x in r[:-1]))
 def test_security_no_cache_or_external_scripts(self):
  h=json.loads(build()['Resources']['AdminApp']['Properties']['CustomHeaders'])['customHeaders'][0]['headers'];d={x['key']:x['value'] for x in h};self.assertIn('no-store',d['Cache-Control']);self.assertIn("script-src 'self';",d['Content-Security-Policy']);self.assertEqual(d['X-Frame-Options'],'DENY')
 def test_production_connections_are_explicitly_allowed_by_browser_policy(self):
  headers=json.loads(build()['Resources']['AdminApp']['Properties']['CustomHeaders'])['customHeaders'][0]['headers']
  csp=next(h['value'] for h in headers if h['key']=='Content-Security-Policy')
  connect=next(d.strip() for d in csp.split(';') if d.strip().startswith('connect-src '))
  self.assertEqual(connect.split()[1:],[
   "'self'", 'https://cognito-idp.us-east-1.amazonaws.com',
   'https://44rmfvjxp8.execute-api.us-east-1.amazonaws.com',
   'wss://x7o502lmzk.execute-api.us-east-1.amazonaws.com/production',
  ])
if __name__=='__main__':unittest.main()
