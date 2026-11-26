# Staging settlement release 113 — publication review

This release is limited to staging account `699561669180`, region `us-east-1`.

## Concrete publication targets

1. Four existing Lambda functions, with unchanged runtime, role, handler, environment, timeout and financial flags:
   - `staging-account-deletion-financial-expiry`: recognize retained settlement evidence and keep it protected from expiry.
   - `staging-account-deletion-worker`: archive statement/schedule/approval evidence before merchant cleanup.
   - `staging-wizz-staff-service`: authenticated financial schedule routes and owner-consent adapter, with creation gate still closed.
   - `order-receiver-regional-staging-unified-auth-v4-sam`: forward the new authenticated merchant schedule endpoint.
2. One protected merchant API path, `/auth/settlement-schedules`, copying the existing protected branch-staff route's GET/POST Cognito authorization and Lambda integration. OPTIONS only serves CORS. Unrelated current methods must match the deployed stage before publication.
3. The staging Amplify website `d2vmebm1e1n95m`, branch `staging`: add schedules in `pages/finance.html`, a link from Merchants, and `settlement-schedules.js`.

Only reviewed entries change in captured deployment archives. The hosted Arabic shell and unrelated merchant-handler edits are preserved. Prior packages, code hashes/revisions and stage metadata are retained privately for rollback/review. No full SAM stack deployment, runtime upgrade, user reset, wallet/ledger/payout operation or financial flag activation is included. `SETTLEMENT_SCHEDULE_ADMIN_ENABLED` remains absent/false.

## Validation and permission status

- 108 local settlement/route/auth tests passed, plus the browser fixture for the financial page's independent directory, exact Baghdad dates, read-only state and stable retry.
- Real DynamoDB test passed in a disposable isolated table, including competing approvals, historical versions, 15 immutable archive copies and retry. The table was deleted; application tables and balances were untouched.
- Five deployment archives passed syntax and unrelated-entry preservation checks.
- The user explicitly approved `SettlementRetention113`; that limited retention IAM policy is applied. No further IAM grant is part of this code/UI publication approval.
- New endpoint and authenticated phone/admin integration still require live verification. The existing Part103 order test remains paused for OTP recovery.

## Operational risk

Publishing live staging code can temporarily affect requests or merchant account deletion if a dependency/configuration differs from the captured base. Code publication must use captured revisions and stop on drift; package and configuration checks must pass afterward. Keep schedule creation closed during these checks. This approval does not authorize activation or disbursement.

## Completed status

The user explicitly approved the described publication. All four Lambda overlays, protected merchant path and Amplify staging job101 were published and verified. The schedule administration gate remains closed. No phone app was installed and authenticated owner testing remains pending OTP recovery.


## Subsequent activation

Part114 supersedes the closed-gate state above following the user's instruction to complete remaining activation without waiting for OTP recovery. See `finance-settlement-schedule-activation-114.json`; Part113 remains the immutable publication record.
