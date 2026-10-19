# Staging settlement deployment — permission review 113

Current AWS role policies were captured read-only and 32 action/resource/key cases were simulated. Five required cases are denied for the existing account-deletion worker. No IAM changes have been applied.

The concrete policy is `backend/finance-settlement-retention-access.staging.json`, bound to the existing worker role captured from staging. It adds only:

- `dynamodb:ConditionCheckItem` on `staging-MerchantPlatform`, limited by `dynamodb:LeadingKeys` to `BRANCH#*` and `MERCHANT_SETTLEMENT#*`. This pins existing statement/schedule source records while their immutable archive copy is written.
- `dynamodb:GetItem`, `dynamodb:Query`, `dynamodb:ConditionCheckItem` on `staging-PlatformStaff`, limited to `SETTLEMENT_SCHEDULE_AUDIT#*`. This reads and pins the branch schedule approval audit.

No new source update/delete, wallet, ledger, payable, transfer, payout, user-authentication or IAM-management permission is included. Existing permissions are not removed or replaced. The inline policy name is `SettlementRetention113`.

The staff API and merchant proxy need no additional permissions according to the captured policies and simulation. Lifecycle existence reads were corrected to project only `pk` and `sk`, matching the staff role's current attribute restriction.

The local platform UI now lives under `pages/finance.html`, using the existing `finance.read` page access and a server-authorized minimal branch directory. No merchant-administration role or direct browser DynamoDB grant is added.

Deployment packages are narrow overlays on fresh captured artifacts. The merchant handler and hosted HTML contain unrelated local differences; those are preserved from the captured live release instead of copying entire local files. Schedule activation remains separately gated. The merchant API route is absent and still needs a staged route deployment; current financial flags and all balances are unchanged.

## Completed status

The user explicitly approved the scoped policy; it was applied and all32 required IAM cases now simulate as allowed. No wallet/ledger/hold/transfer permission was added.
