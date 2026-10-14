# Durable order/wallet lifecycle — Staging, 2026-10-12

## Implemented

- A `staging-WalletLifecycle` record is created atomically with each new hold. Outcomes are saved atomically with release/capture monetary transactions. Table encryption, PITR and retention are enabled.
- Due work is indexed by `queuePartition`/`nextAttemptAt` in `ByDue`; completed/review records leave the pending queue.
- A dedicated Staging worker runs once a minute with a narrowly scoped IAM role. It reads canonical holds and orders, leases work, and retries transient failures with bounded backoff. Ambiguous or contradictory states require review; they never trigger speculative refunds.
- Release/capture transactions include a condition check on the authoritative order snapshot. A stale assignment cannot settle/refund a newer one.
- Order cancellation and unassignment persist the terminal/reassignment state and `PENDING_RELEASE` reference before the wallet request. Removing the active hold reference does not lose the pending financial operation.
- Driver delivery persists `delivered`/`PENDING_CAPTURE` before capture. Repeated delivery/acceptance are idempotent; ownership and appropriate delivery phase are checked before settlement.
- Failed acceptance saves an explicit release intent; only a guarded worker releases it. A late successful assignment is reviewed rather than refunded blindly. If assignment succeeded but linking the hold failed, the worker restores the matching hold reference without making a second hold.
- Driver live-state cleanup is guarded by the current order pointer and count, preserves offline preference, and cannot erase a newer trip. Delivery, cancellation and unassignment retries recover durable outcomes without repeating wallet operations.
- Financial UI displays monitoring, retry, settled, complete and review states. A financial approver can schedule a reviewed retry with a reason and recent authentication; staff version and audit are committed atomically. This action cannot change the amount.
- Ledger/audit keys contain transaction IDs to prevent same-millisecond overwrites. Frozen wallets cannot create new holds.

## Identity protection

OrderService now verifies signatures, issuer, client and expiry using the AWS-maintained [aws-jwt-verify library](https://github.com/awslabs/aws-jwt-verify). Only the known Staging Cognito pools/clients are accepted. Customer/driver identities and merchant ownership are bound to stored records. Central operations read active staff permissions and live MFA configuration. Service tokens must belong to the configured service principal. Guest cancellation requires the matching stored guest proof and still-guest state; an account merge revokes that guest path.

Driver service calls pass signed service tokens. User cancellation forwards caller authentication/guest proof. User and merchant Flutter cancellation calls now pass authentication; their installed apps must be rebuilt for this protected path. Order notifications no longer target the legacy Dev WebSocket API; Staging table/API IAM scopes are explicit.

## Evidence and limits

- 71 wallet tests, 9 OrderService lifecycle/identity tests, 10 driver lifecycle/cleanup tests and 6 staff-authorizer policy tests passed. Targeted financial UI/RBAC checks passed; modified Dart files parsed successfully.
- Disposable real-DynamoDB integration exercises successful transfer, independent approval, ceilings, duplicate requests, cancellation, unassignment, lost acknowledgements, reference repair and failed-acceptance release intent. Nine isolated tables are removed after each run; no operational money or user notifications are seeded.
- Live OrderService smoke checks reject missing/forged tokens with 401 and accept a correctly signed service token up to a nonexistent-order 404; no real order is mutated. Worker invocation succeeded with zero pending operations.
- Paired employee-browser approval and a real mobile order walkthrough are still required. These are not replaced by the isolated integration tests. Existing historical holds without lifecycle records are not automatically backfilled or refunded. Production is unchanged.

## Deployment

Wallet stack: `staging-wizz-wallet-service`; worker: `staging-wizz-wallet-lifecycle`.
OrderService and DriversApi Staging packages were updated by replacing only the relevant modules (and the signature-verification dependency), retaining package backups and existing configuration. The user cancellation function forwards the authentication proof. Scoped Staging notification and identity lookup IAM policies are represented in OrderService template source. Amplify hosts the updated financial page.

## Interactive Staging verification — 2026-10-12

The owner explicitly authorized a 25,000 IQD test-only operational credit for driver 5458d478-90e1-7098-07fb-7a1c308ea5a2. It was recorded atomically with a ledger entry, audit record and permanent idempotency reference; it is not a ZainCash receipt or real payment.

- Order daf4d22d-835e-4f9b-b966-2f748d942304: driver accepted, 5,700 IQD held; available 19,300, locked 5,700. Driver unassignment released once; available returned to 25,000, locked zero. Worker synchronized the release to COMPLETED/RELEASED. The order remains reassigning, not canceled outright.
- Order ORD1791833039535 (65942c78-71cc-4883-ae0d-517915a45ded): delivered, 6,000 IQD captured once. Matching ledger debit/credit share txn_1791833158757_ae71ee99. Driver available 19,000, locked zero; platform available 6,000. Lifecycle COMPLETED/CAPTURED, no error.
- Transfer 83c4e52a-573b-45fa-8bff-02464a5ce3cc: 6,000 IQD platform-to-driver, created by bootstrap administrator and approved by Muhammad Ali's distinct account. Stored status COMPLETED; final driver available 25,000, locked zero; platform available/locked zero. User confirmed the driver received the transfer notification.

These interactive results cover unassignment, delivery/capture and independent administrative transfer approval. Actual customer cancellation, duplicate mobile submissions and interrupted mobile financial requests still need separate interactive scenarios; automated tests cover those failure cases. Release-mode driver installation uses Staging configuration and avoids dependency on the iOS debug session.
