# Staging execution permissions — explicitly approved and applied

Automatic approval review rejected applying these persistent IAM changes. The user subsequently explicitly approved this exact scope. The six role policies were applied successfully; previous policy content was backed up. No driver or merchant wallet permissions were added.

| Execution role | Additional capability |
| --- | --- |
| Existing notifications role (shared by notification handlers) | Read only the `OPERATIONAL_SETTINGS#ORDER_RECEPTION` partition of `staging-PlatformStaff`; read/condition-check `WizzOrders` and `WizzUser_users_staging` to verify the activity belongs to the signed-in customer or guest. No new secret IDs. |
| Existing CreateOrder role | Read that settings partition; write merchant response queue records. |
| Existing merchant-order role | Read the policy; acknowledge the response queue; atomically reject an unaccepted order and record its audit/outcome. If promotion funding exists, release it only through wallet/ledger partition `WALLET#PLATFORM`. |
| Existing merchant-status and unified-auth roles | Read policy, manage merchant-response/pause queue records, and write reception audits. |
| New `staging-merchant-response-99` role | Execute absolute deadlines, opt-in automatic acceptance and guarded pause resume. Read/write only the listed staging order, branch, lifecycle, hold and audit resources. Query only `ByDue` for the `MERCHANT_RESPONSE` partition. Stream read access only to `WizzOrders`. Wallet/ledger writes restricted to `WALLET#PLATFORM`. Write logs only for its function. |

Queue permissions are restricted to `MERCHANT_RESPONSE#*` and `MERCHANT_RESUME#*`. Existing roles/policies remain in place; prior inline policy content is backed up before any change. Financial rollout scope checks remain required. No permissions for changing driver or merchant wallets are added. The pre-acceptance release checks and balanced journal protect promotion funding; this is still persistent financial write authority, which is why explicit approval is required.

Prepared executable: `scripts/apply-reception-permissions-99.py`. Exact resource/action/condition documents are private deployment artifacts at `/private/tmp/finance98/permissions99.private.json` (no credentials). Public affected role names: `reception-notification-permissions-99.json`.
