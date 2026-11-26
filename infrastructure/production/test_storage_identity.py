import json
import unittest

from preflight import ROOT, validate_common


class FreshProductionResourcesTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((ROOT / "environment.json").read_text())

    def test_account_isolation_for_both_templates(self):
        for filename in ("storage-core.template.json", "storage-catalog.template.json", "storage-auth.template.json", "storage-dispatch.template.json", "identity-admin.template.json", "identity-phone.template.json"):
            with self.subTest(template=filename):
                self.assertEqual(validate_common(self.manifest, (ROOT / filename).read_text()), [])

    def test_storage_is_protected_and_recoverable(self):
        template = json.loads((ROOT / "storage-core.template.json").read_text())
        self.assertEqual(len(template["Resources"]), 10)
        for resource in template["Resources"].values():
            props = resource["Properties"]
            self.assertTrue(props["DeletionProtectionEnabled"])
            self.assertTrue(props["PointInTimeRecoverySpecification"]["PointInTimeRecoveryEnabled"])
            self.assertTrue(props["SSESpecification"]["SSEEnabled"])
            self.assertEqual(props["BillingMode"], "PAY_PER_REQUEST")
            self.assertTrue(props["TableName"].startswith("wizz-production-"))
            self.assertNotIn("ImportSourceSpecification", props)

    def test_dispatch_storage_preserves_keys_and_expiry_without_imports(self):
        template = json.loads((ROOT / "storage-dispatch.template.json").read_text())
        expected = {
            "WaveOffers": (["orderId", "SK"], {"driverId-sentAt-index"}, "NEW_AND_OLD_IMAGES", True),
            "DispatchJobs": (["orderId", "SK"], {"DispatchReviewStatus340", "orderId-index"}, "NEW_IMAGE", False),
            "DriverLiveState": (["driverId"], set(), None, False),
            "OfferJourney": (["pk", "sk"], set(), None, True),
        }
        self.assertEqual(set(template["Resources"]), {role + "Table" for role in expected})
        for role, (keys, indexes, stream, ttl) in expected.items():
            props = template["Resources"][role + "Table"]["Properties"]
            self.assertEqual(props["TableName"], "wizz-production-" + role)
            self.assertEqual([key["AttributeName"] for key in props["KeySchema"]], keys)
            self.assertEqual({index["IndexName"] for index in props.get("GlobalSecondaryIndexes", [])}, indexes)
            self.assertEqual(props.get("StreamSpecification", {}).get("StreamViewType"), stream)
            self.assertEqual(props.get("TimeToLiveSpecification"), {"Enabled": True, "AttributeName": "ttl"} if ttl else None)
            self.assertTrue(props["DeletionProtectionEnabled"])
            self.assertTrue(props["PointInTimeRecoverySpecification"]["PointInTimeRecoveryEnabled"])
            self.assertTrue(props["SSESpecification"]["SSEEnabled"])
            self.assertNotIn("ImportSourceSpecification", props)

    def test_catalog_schema_preserves_indexes_without_importing_records(self):
        template = json.loads((ROOT / "storage-catalog.template.json").read_text())
        mapping = json.loads((ROOT / "storage-catalog-map.json").read_text())
        reference = json.loads((ROOT.parent.parent / "docs/production-schema-reference-2026-11-15.json").read_text())
        sources = {x["sourceTable"]: x for x in reference["tables"]}
        self.assertEqual(len(template["Resources"]), 15)
        self.assertFalse(mapping["referenceConfigurationSeeded"])
        for row in mapping["tables"]:
            props = template["Resources"][row["role"] + "Table"]["Properties"]
            source = sources[row["schemaReference"]]
            self.assertEqual(props["KeySchema"], source["keySchema"])
            indexes=props.get("GlobalSecondaryIndexes", [])
            if row["role"] == "Merchants":
                self.assertEqual([i for i in indexes if i["IndexName"] != "ownerId-index"], source["globalSecondaryIndexes"])
                self.assertEqual([i for i in indexes if i["IndexName"] == "ownerId-index"], [{"IndexName":"ownerId-index","KeySchema":[{"AttributeName":"ownerId","KeyType":"HASH"}],"Projection":{"ProjectionType":"KEYS_ONLY"}}])
            else:
                self.assertEqual(indexes, source["globalSecondaryIndexes"])
            self.assertEqual(props.get("LocalSecondaryIndexes", []), source["localSecondaryIndexes"])
            self.assertTrue(props["DeletionProtectionEnabled"])
            self.assertTrue(props["PointInTimeRecoverySpecification"]["PointInTimeRecoveryEnabled"])
            self.assertTrue(props["SSESpecification"]["SSEEnabled"])
            self.assertNotIn("ImportSourceSpecification", props)
            self.assertFalse(row["dataCopied"])

    def test_auth_storage_is_empty_protected_and_expiring(self):
        from prepare_auth_storage import build
        template, mapping = build()
        self.assertEqual(template, json.loads((ROOT / "storage-auth.template.json").read_text()))
        self.assertEqual(mapping["recordsCopied"], 0)
        self.assertEqual(len(template["Resources"]), 9)
        for name, resource in template["Resources"].items():
            props = resource["Properties"]
            self.assertTrue(props["DeletionProtectionEnabled"])
            self.assertTrue(props["SSESpecification"]["SSEEnabled"])
            if name == "MerchantFinancialSessionsTable":
                self.assertNotIn("PointInTimeRecoverySpecification", props)
                self.assertEqual(props["TimeToLiveSpecification"], {"Enabled": True, "AttributeName": "ttl"})
            else:
                self.assertTrue(props["PointInTimeRecoverySpecification"]["PointInTimeRecoveryEnabled"])
            self.assertNotIn("ImportSourceSpecification", props)
        for role in ("CustomerPhoneAuth", "DriverOtpSessions"):
            self.assertEqual(template["Resources"][role + "Table"]["Properties"]["TimeToLiveSpecification"],
                             {"Enabled": True, "AttributeName": "expiresAt"})
        self.assertNotIn("TimeToLiveSpecification", template["Resources"]["AccountDeletionFinancialArchiveTable"]["Properties"])

    def test_phone_identity_has_no_password_login_or_public_registration(self):
        template = json.loads((ROOT / "identity-phone.template.json").read_text())
        self.assertEqual(len(template["Resources"]), 6)
        for role in ("Customer", "Driver", "Merchant"):
            pool = template["Resources"][role + "UserPool"]["Properties"]
            client = template["Resources"][role + "Client"]["Properties"]
            self.assertTrue(pool["AdminCreateUserConfig"]["AllowAdminCreateUserOnly"])
            self.assertEqual(pool["DeletionProtection"], "ACTIVE")
            self.assertEqual(set(client["ExplicitAuthFlows"]), {"ALLOW_CUSTOM_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"})
            self.assertFalse(client["GenerateSecret"])
            self.assertTrue(client["EnableTokenRevocation"])
            self.assertNotIn("AutoVerifiedAttributes", pool)
            self.assertNotIn("SmsConfiguration", pool)

    def test_no_admin_or_old_sessions_created(self):
        template = json.loads((ROOT / "identity-admin.template.json").read_text())
        self.assertEqual({r["Type"] for r in template["Resources"].values()},
                         {"AWS::Cognito::UserPool", "AWS::Cognito::UserPoolClient"})
        pool = template["Resources"]["AdminUserPool"]["Properties"]
        self.assertTrue(pool["AdminCreateUserConfig"]["AllowAdminCreateUserOnly"])
        self.assertEqual(pool["DeletionProtection"], "ACTIVE")
        self.assertEqual(pool["MfaConfiguration"], "OPTIONAL")
        self.assertEqual(pool["EnabledMfas"], ["SOFTWARE_TOKEN_MFA"])
        client = template["Resources"]["AdminWebClient"]["Properties"]
        self.assertFalse(client["GenerateSecret"])
        self.assertTrue(client["EnableTokenRevocation"])


if __name__ == "__main__":
    unittest.main()
