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

Retention durations and monetary refund method are awaiting the user's policy input. Those are not assumed from other companies. No automatic final purge is enabled. Personal-data cleanup and retained financial records must be addressed separately; a missing policy is not permission to keep all personal data indefinitely.

First safety patch is separate:
- Customer fake-success UI/service removed locally; authenticated final deletion not yet connected.
- Historical merchant endpoint replaced with a fail-closed authenticated response, deployed to Staging. No unverified JWT fallback, no full-request logging, no database or Cognito deletion in that legacy route. Its four guard tests passed.

SAM/deployment wiring, integration evidence and app installation are still pending for the new flow.
