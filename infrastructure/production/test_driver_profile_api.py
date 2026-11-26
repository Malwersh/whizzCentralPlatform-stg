import unittest,json
from pathlib import Path
from prepare_driver_profile_api import build
from preflight import validate_common
class DriverProfileApiTests(unittest.TestCase):
 def test_every_route_requires_own_driver_pool(self):
  t=build();self.assertEqual(validate_common(json.loads((Path(__file__).parent/'environment.json').read_text()),json.dumps(t)),[])
  methods=[r for r in t['Resources'].values() if r['Type']=='AWS::ApiGateway::Method'];self.assertEqual(len(methods),8)
  self.assertTrue(all(x['Properties']['AuthorizationType']=='COGNITO_USER_POOLS' for x in methods))
  self.assertEqual(t['Resources']['Function']['Properties']['Environment']['Variables']['PROFILE_API_ENABLED'],{'Ref':'ProfileApiEnabled'})
 def test_vehicle_routes_are_active_in_the_stage_deployment(self):
  resources=build()['Resources']
  self.assertEqual(resources['Stage']['Properties']['DeploymentId'],{'Ref':'VehicleDeployment'})
  self.assertTrue({'VehicleReadMethod','VehicleUpdateMethod','VehicleUploadMethod'}.issubset(resources['VehicleDeployment']['DependsOn']))
  statements=resources['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  live=next(s for s in statements if s['Resource']['Fn::Sub'].endswith('DriverLiveState'))
  self.assertEqual(set(live['Action']),{'dynamodb:GetItem','dynamodb:ConditionCheckItem'})
 def test_no_financial_permissions_and_private_object_prefix(self):
  statements=build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  self.assertNotIn('Wallets',json.dumps(statements));self.assertNotIn('s3:ListBucket',json.dumps(statements))
  obj=next(s for s in statements if 's3:PutObject' in s['Action']);self.assertTrue(obj['Resource']['Fn::Sub'].endswith('/drivers/*'))
if __name__=='__main__':unittest.main()
