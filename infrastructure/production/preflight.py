#!/usr/bin/env python3
"""Read-only production preflight. Never creates resources or copies data."""
import argparse
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent
EXPECTED_ACCOUNT = "746727375268"
FORBIDDEN_ACCOUNTS = ("031857856164", "699561669180", "146152253137")


def validate_common(manifest, template_text):
    errors = []
    if manifest.get("accountId") != EXPECTED_ACCOUNT:
        errors.append("Production account mismatch")
    if manifest.get("environment") != "production":
        errors.append("Canonical environment must be production")
    if manifest.get("copyTestData") is not False or manifest.get("copySessions") is not False:
        errors.append("Test data and session copying must remain disabled")
    for account in FORBIDDEN_ACCOUNTS:
        if account in template_text or account in json.dumps(manifest):
            errors.append("Cross-account reference: " + account)
    if re.search(r"\bstaging\b|Wizz_dev_UserApp|Wizz_stg_UserApp", template_text):
        errors.append("Non-production deployment reference")
    template = json.loads(template_text)
    if template.get("Parameters", {}).get("ExpectedAccountId", {}).get("AllowedValues") != [EXPECTED_ACCOUNT]:
        errors.append("Template account constraint missing")
    if "ProductionAccountOnly" not in template.get("Rules", {}):
        errors.append("Template account rule missing")
    expected_condition = {"Fn::Equals": [{"Ref": "AWS::AccountId"}, {"Ref": "ExpectedAccountId"}]}
    if template.get("Conditions", {}).get("IsProductionAccount") != expected_condition:
        errors.append("Actual deployment account condition missing")
    for name, resource in template.get("Resources", {}).items():
        if resource.get("Condition") != "IsProductionAccount":
            errors.append("Resource is not account-constrained: " + name)
    retained_types = {"AWS::DynamoDB::Table", "AWS::Cognito::UserPool", "AWS::S3::Bucket", "AWS::Logs::LogGroup"}
    for name, resource in template.get("Resources", {}).items():
        if resource.get("Type") in retained_types:
            if resource.get("DeletionPolicy") != "Retain" or resource.get("UpdateReplacePolicy") != "Retain":
                errors.append("Retention protection missing: " + name)
    return errors


def validate(manifest, template_text):
    errors = validate_common(manifest, template_text)
    template = json.loads(template_text)
    for name in ("AuditBucket", "AuditLogGroup"):
        if name not in template.get("Resources", {}):
            errors.append("Audit resource missing: " + name)
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--online", action="store_true", help="Also verify STS identity; read-only")
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    manifest = json.loads((ROOT / "environment.json").read_text())
    template_text = (ROOT / "foundation.template.json").read_text()
    errors = validate(manifest, template_text)
    result = {"accountId": EXPECTED_ACCOUNT, "offlineValidation": "FAIL" if errors else "PASS",
              "onlineIdentity": "NOT_CHECKED", "errors": errors, "mutationsPerformed": False}
    if args.online and not errors:
        identity = json.loads(subprocess.check_output([
            "aws", "sts", "get-caller-identity", "--profile", manifest["awsProfile"],
            "--region", manifest["region"], "--output", "json"], text=True))
        if identity["Account"] != EXPECTED_ACCOUNT:
            result["errors"].append("Refusing wrong AWS account")
            result["onlineIdentity"] = "FAIL"
        else:
            result["onlineIdentity"] = "PASS"
    output = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.write_text(output)
    print(output, end="")
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
