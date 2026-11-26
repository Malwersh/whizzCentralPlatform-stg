import copy
import json
import unittest

from preflight import ROOT, validate


class ProductionBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((ROOT / "environment.json").read_text())
        self.template = json.loads((ROOT / "foundation.template.json").read_text())

    def check(self):
        return validate(self.manifest, json.dumps(self.template))

    def test_valid_foundation(self):
        self.assertEqual(self.check(), [])

    def test_other_accounts_are_rejected(self):
        for account in ("031857856164", "699561669180", "146152253137"):
            with self.subTest(account=account):
                self.manifest["accountId"] = account
                self.assertTrue(self.check())

    def test_data_and_sessions_cannot_be_imported(self):
        for flag in ("copyTestData", "copySessions"):
            with self.subTest(flag=flag):
                original = copy.deepcopy(self.manifest)
                self.manifest[flag] = True
                self.assertTrue(self.check())
                self.manifest = original

    def test_cross_account_resource_rejected(self):
        self.template["Description"] = "arn:aws:dynamodb:us-east-1:699561669180:table/example"
        self.assertTrue(self.check())

    def test_account_condition_cannot_be_removed(self):
        self.template["Conditions"] = {}
        self.assertTrue(self.check())

    def test_resource_cannot_escape_account_guard(self):
        del self.template["Resources"]["ManagementTrail"]["Condition"]
        self.assertTrue(self.check())

    def test_audit_storage_cannot_be_deleted_with_stack(self):
        self.template["Resources"]["AuditBucket"]["DeletionPolicy"] = "Delete"
        self.assertTrue(self.check())


if __name__ == "__main__":
    unittest.main()
