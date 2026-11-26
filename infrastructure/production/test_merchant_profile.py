import importlib.util,json,unittest,zipfile,io,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('merchant_profile_builder',ROOT/'prepare_merchant_profile.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class DeploymentTests(unittest.TestCase):
 def test_disabled(self):
  t=m.build();self.assertEqual(t['Resources']['Function']['Properties']['Environment']['Variables']['PROFILE_API_ENABLED'],{'Ref':'ProfileApiEnabled'})
 def test_authorized_routes_only(self):
  methods=[v['Properties'] for v in m.build()['Resources'].values() if v['Type']=='AWS::ApiGateway::Method'];self.assertEqual(len(methods),2);self.assertTrue(all(x['AuthorizationType']=='COGNITO_USER_POOLS' for x in methods))
 def test_iam_no_wallet_or_identity_creation(self):
  t=m.build();policy=t['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument'];raw=json.dumps(policy);self.assertNotIn('Wallet',raw);self.assertNotIn('AdminCreateUser',raw);self.assertNotIn('Scan',raw);self.assertNotIn('DeleteItem',raw);self.assertIn('PERSON#*',raw)
 def test_account_and_version_pinned(self):
  t=m.build();self.assertEqual(t['Parameters']['ExpectedAccountId']['AllowedValues'],['746727375268']);self.assertIn('S3ObjectVersion',t['Resources']['Function']['Properties']['Code'])
 def test_bundle_resolves_and_disabled_handler(self):
  raw=m.package();self.assertEqual(raw,m.package())
  with tempfile.TemporaryDirectory() as d:
   with zipfile.ZipFile(io.BytesIO(raw)) as z:z.extractall(d)
   result=subprocess.run(['node','-e',"require('./personal-profile.cjs'); require('./index.cjs').handler({}).then(r=>{if(r.statusCode!==503)process.exit(1)})"],cwd=d,capture_output=True,text=True)
   self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
