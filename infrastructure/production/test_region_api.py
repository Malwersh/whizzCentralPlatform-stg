import unittest
from prepare_region_api import build

class RegionApiTests(unittest.TestCase):
 def test_read_only_permissions(self):
  t=build(); statements=t['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  actions={a for s in statements if 'Action' in s for a in s['Action']}
  self.assertFalse(actions & {'dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem','sqs:SendMessage'})
 def test_routes_and_gates(self):
  t=build();r=t['Resources'];methods=[v['Properties'] for v in r.values() if v['Type']=='AWS::ApiGateway::Method']
  self.assertEqual(len(methods),9);self.assertEqual(sum(x['HttpMethod']=='GET' for x in methods),3);self.assertEqual(sum(x['HttpMethod']=='POST' for x in methods),6)
  env=r['Function']['Properties']['Environment']['Variables'];self.assertEqual(env['REGION_WRITES_ENABLED'],{'Ref':'WritesEnabled'});self.assertEqual(env['REGION_COMPOSITE_READERS_READY'],{'Ref':'ReadersReady'});self.assertEqual(t['Parameters']['WritesEnabled']['Default'],'false');self.assertEqual(t['Parameters']['ReadersReady']['Default'],'false')
 def test_writes_are_scoped_and_conditional(self):
  t=build();ss=t['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  gated=[s['Fn::If'] for s in ss if 'Fn::If' in s]
  self.assertEqual(len(gated),6)
  for condition,statement,otherwise in gated:
   self.assertEqual(condition,'RegionWritesActive');self.assertEqual(otherwise,{'Ref':'AWS::NoValue'})
   self.assertNotIn('dynamodb:UpdateItem',statement['Action'])
  self.assertEqual(gated[-1][1]['Action'],['sqs:SendMessage'])
  self.assertIn('wizz-production-region-publication',str(gated[-1][1]['Resource']))
  check=gated[0][1]
  self.assertEqual(check['Action'],['dynamodb:Scan'])
  self.assertEqual(check['Condition'],{'StringEquals':{'dynamodb:Select':'COUNT'}})
 def test_account_and_resource_isolation(self):
  import json
  t=build();text=json.dumps(t)
  self.assertNotIn('699561669180',text);self.assertNotIn('staging-',text)
  self.assertTrue(all(v.get('Condition')=='IsProductionAccount' for v in t['Resources'].values()))

if __name__=='__main__':unittest.main()
