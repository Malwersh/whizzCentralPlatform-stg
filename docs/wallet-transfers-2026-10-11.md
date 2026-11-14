# Staging wallet transfer foundation

Implemented server-side driver transfer request and finance platform request/independent approval. Source is derived from verified authorizer identity; body cannot select it. Only designated Cognito app-client access tokens are accepted for transfer routes. User authentication must be within five minutes (auth_time, not token refresh time). Finance endpoints additionally require finance_manager. Runtime enables mutations only in staging.

Each completed transfer atomically includes version-guarded active IQD source/recipient available balance updates, equal/opposite ledger entries, permanent immutable request/retry record, daily outgoing reservation, financial audit and durable recipient outbox events. Locked funds cannot be spent. Ambiguous network retries use the same UUID; payload changes conflict. Conflicting transactions reread a completed record only after matching source, initiator, recipient, amount and reason.

Initial thresholds: 1000–100000 IQD per transfer; 100000 IQD daily outgoing per personal wallet and 1000000 for platform. Platform request expires after one hour; requester cannot approve their own request. Request creation does not reserve/debit platform funds; approval rechecks balance and limits. These values are now persisted in versioned CONFIG#TRANSFERS settings; changes require a proposal, independent finance approval and audit. Daily counters use Baghdad calendar days.

Finance UI adds platform request creation, listing/pagination and independent approval. Load operational wallets first to populate existing active recipients. A second finance-manager identity is required for end-to-end approval acceptance. No actual transfer executed during development; operational balances remain zero after authorized test reset.

API routes: POST /wallet/transfers/request (driver); GET /wallet/funding/admin/transfers; POST /wallet/funding/admin/transfer; POST /wallet/funding/admin/transfer/approve. Financial requests are stored under TRANSFER#uuid in the existing idempotency table; permanent records retained, no expiry deletion. Listing scans are bounded per page; a dedicated indexed transfer table is needed for larger deployment volume.

Remaining before full rollout: customer pool authentication and zero-wallet provisioning; source/recipient phone resolution and confirmation with account status gates; driver/customer transfer screens and step-up UX; cancel/reject/reversal flow; separate configurable maker/checker permissions; limits configuration; customer transfer notifications routing; throttling and concurrent integration tests. No claim of complete customer transfers or production readiness.

Tests: 39 wallet tests and 24 central tests pass; new tests cover atomic balanced posting, available/locked boundary, idempotency conflict, insufficient funds, stale authentication, maker/checker separation and concurrent completion. Driver wallet push routing now recognizes wallet_transfer_completed; its two routing tests pass. No customer wallets are created by this increment. No production/Dev resources touched.


## Versioned settings implementation
GET/POST /wallet/funding/admin/transfer-settings, POST /approve and POST /cancel. All routes require finance_manager and designated admin-client access tokens. Sensitive policy actions additionally require authentication in the last five minutes. Single pending proposal expires after one hour; stale base versions cannot apply, maker cannot approve, cancellation cannot race successfully with approval. Active version update, pending status and immutable audit are atomic. Bootstrap persists the unchanged initial policy as version 1, with audit; balances untouched.

Transfer amount/day limits, enabled flag, request lifetime and transfer reauthentication window read from strong configuration each execution. The financial transaction checks the exact configuration version, preventing concurrent policy changes from using stale limits. Approval uses current amount limits and shortened request lifetime, never extending a pending request beyond its original expiry. Completed retries can return the original result even after limits change; no second debit occurs.

Timezone is Asia/Baghdad for Iraq. Hard safety envelopes (positive safe integers, consistent limits, maximum 15-minute transfer reauth, 24-hour money request lifetime, two distinct finance identities) cannot be disabled. Bootstrap/config changes do not change balances or retroactively reset daily counters. User/customer wallet enablement remains separate scope.

Validation: 46 wallet tests and 28 central tests pass; includes Baghdad midnight boundary, invalid policy, proposed versus active separation, independent approval, concurrent version guard, lowering a pending transfer limit and disabling transfers. SAM deploy succeeded. Authenticated two-person settings-change acceptance remains required.
