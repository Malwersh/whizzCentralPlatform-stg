# Account deletion coordinator — implementation in progress

Scope: Staging only. No production rollout and no account deletion has been performed.

Implemented foundation:
- `policy.js`: authenticated subject selection; account/business/membership boundaries; wallet, hold, order, transfer, ownership, administrator succession blockers; immediate READY when inventory and retention policy are approved.
- `coordinator.js`: durable scoped request contract, atomic OTP-consumption/storage adapter contract, idempotency, pinned retention-policy lookup, ownership checks, execution locking contract, per-step resume and accurate completion/retry status.
- `store.js`: DynamoDB storage implementation with atomic OTP consumption and request creation, one active request per scope, version-checked state updates, and durable per-step receipts. Deployment and AWS integration remain pending.
- 26 policy/coordinator/storage tests: `node --test backend/account-deletion/test/*.test.cjs`.

This directory is NOT a deployed deletion API. `store` must be wired to a deployed table and integration-tested; `adapters`, `settings`, and `verifyDeletionChallenge` still need their application integrations. Unit tests use in-memory adapters and do not prove cross-service concurrency, SMS delivery, or AWS cleanup. Do not connect a deletion button to this domain library without those dependencies.

Required next work, customer first:
1. Persistent request, step, OTP, settings and audit stores with scoped IAM and atomic writes. Reject requests from wrong Cognito pools/app clients.
2. Data inventory and owner-safe resolution for both legacy userId and Cognito subject; both customer wallet systems, completed/live orders, addresses, favorites, uploaded assets, device tokens, notification and WebSocket state.
3. Purpose-bound deletion SMS challenge. Never reuse login/transfer/link proofs. Enrollment/status/errors must not log OTPs/tokens.
4. Conditional eligibility lock honored by all creation/transfer/assignment services, including old access JWTs. Job resume must remain possible after disabling the sign-in identity.
5. Monetary settlement workflow; a nonzero balance creates a pending request and cannot be erased.
6. Customer adapter, worker and OTP/status UI; dedicated disposable integration identity with verified cleanup evidence.
7. Driver, merchant/employee ownership, then platform staff adapters and screens. Never delete a merchant's other businesses or shared catalog when closing one business.

The owner approved the operational policy: seven financial years, zero extra retention for eligible personal/location/document/support data, and wallet-transfer or documented manual Zain Cash settlement. The policy is stored in staging-PlatformStaff and can be changed through independent approval in Settings. No automatic final purge is enabled until cleanup inventories and application integrations pass validation. Personal-data cleanup and retained financial records must be addressed separately; a missing policy is not permission to keep all personal data indefinitely.

First safety patch is separate:
- Customer fake-success UI/service removed locally; authenticated final deletion not yet connected.
- Historical merchant endpoint replaced with a fail-closed authenticated response, deployed to Staging. No unverified JWT fallback, no full-request logging, no database or Cognito deletion in that legacy route. Its four guard tests passed.

SAM/deployment wiring, integration evidence and app installation are still pending for the new flow.

## Customer request API deployed on Staging

Stack `staging-account-deletion`, API `https://77j15qyukg.execute-api.us-east-1.amazonaws.com/staging`:
- GET `/deletion/status`: owned durable request receipt.
- GET `/deletion/eligibility`: both wallet systems, live orders/holds/transfers, policy version; `executionReady` is explicitly false.
- POST `/deletion/send`: action-specific SMS to the Cognito-verified phone, bound to subject, scope and request UUID, five-minute TTL and bounded attempts/sends.
- POST `/deletion/request`: verified proof consumed atomically with a durable request; does not claim deletion completed.

`customer-auth.js` requires Cognito GetUser validation and exact customer pool/client/subject/token-use. `customer-evidence.js` resolves legacy profile IDs using verified Cognito bindings and checks both financial stores with full pagination; read errors and malformed balances fail closed. Evidence snapshots are not atomic authorization for deletion. A read-only live check passed for the existing Ghayth test identity: two wallet systems, seven nonterminal order records, no active holds or pending transfers. No data changed.

The request function has no permissions to change balances, remove profiles/assets, or delete Cognito users. Irreversible execution, cross-service eligibility locking, refund processing, automatic retry worker, mobile UI and online deletion page remain unfinished. Do not enable inventory readiness or connect a success message before those integrations are tested.

56 tests pass for the coordinator, storage, policy, version pinning, identity/evidence, scoped OTP and request API boundaries. HTTP smoke test rejects unsigned access with 401. SMS delivery for this new deletion purpose has not yet been manually tested.
