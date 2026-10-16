import importlib.util, os, pathlib, sys, types, unittest
employee = {}; enabled = True; enrolled = True
class Table:
    def get_item(self, **kwargs):
        assert kwargs['ConsistentRead'] is True
        return {'Item': employee}
class Cognito:
    def admin_get_user(self, **kwargs):
        return {'Enabled': enabled, 'UserMFASettingList': ['SOFTWARE_TOKEN_MFA'] if enrolled else []}
sys.modules['boto3'] = types.SimpleNamespace(resource=lambda name: types.SimpleNamespace(Table=lambda table: Table()), client=lambda name: Cognito())
path = pathlib.Path(__file__).resolve().parents[1] / 'authorizer_lambda' / 'staff_policy.py'
spec = importlib.util.spec_from_file_location('staff_policy', path); policy = importlib.util.module_from_spec(spec); spec.loader.exec_module(policy)
class StaffPolicyTests(unittest.TestCase):
    def setUp(self):
        global employee, enabled, enrolled
        os.environ['STAFF_TABLE']='staging-test';os.environ['ADMIN_CLIENT_ID']='client'
        employee={'status':'ACTIVE','roles':['finance_viewer'],'scope':{'allRegions':True},'mfaRequired':True,'version':1};enabled=True;enrolled=True
        self.token={'sub':'id','username':'id','token_use':'access','client_id':'client','auth_time':100}
    def test_viewer_can_read_but_cannot_approve(self):
        policy.access(self.token,'GET','/wallet/funding/admin/wallets','pool')
        with self.assertRaises(Exception): policy.access(self.token,'POST','/wallet/funding/admin/transfer/approve','pool')
    def test_inactive_and_invited_accounts_fail(self):
        for status in ['SUSPENDED','INVITED']:
            employee['status']=status
            with self.assertRaises(Exception): policy.access(self.token,'GET','/wallet/funding/admin/wallets','pool')
    def test_disabled_cognito_identity_fails(self):
        global enabled
        enabled=False
        with self.assertRaises(Exception): policy.access(self.token,'GET','/wallet/funding/admin/wallets','pool')
    def test_removed_mfa_and_old_activation_token_fail(self):
        global enrolled
        enrolled=False
        with self.assertRaises(Exception): policy.access(self.token,'GET','/wallet/funding/admin/wallets','pool')
        enrolled=True;employee['minimumAuthTime']=101
        with self.assertRaises(Exception): policy.access(self.token,'GET','/wallet/funding/admin/wallets','pool')
    def test_approver_does_not_gain_requester_rights(self):
        employee['roles']=['finance_approver']
        policy.access(self.token,'POST','/wallet/funding/admin/transfer/approve','pool')
        with self.assertRaises(Exception): policy.access(self.token,'POST','/wallet/funding/admin/transfer','pool')
    def test_wrong_client_or_id_token_fails(self):
        for field,value in [('client_id','other'),('token_use','id')]:
            with self.assertRaises(Exception): policy.access({**self.token,field:value},'GET','/wallet/funding/admin/wallets','pool')
if __name__=='__main__': unittest.main()
