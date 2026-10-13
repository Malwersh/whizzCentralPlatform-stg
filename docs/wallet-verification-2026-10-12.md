# Wallet verification — Staging, 2026-10-12

## Completed evidence

- TypeScript build passed; 59 wallet Node tests and 6 staff authorizer policy tests passed.
- `scripts/verify-wallet-isolated.cjs` ran compiled service logic against real DynamoDB in account 699561669180/us-east-1, with seven disposable `staging-wallet-verification-*` tables. All tables were deleted in `finally` after both the unsuccessful initial run and successful rerun. No notification consumer was attached.
- 13 integration checks passed: no debit at request, independent approval, self-approval rejection, employee ceiling, revoked requester, duplicate request/approval, conflicting payload, amount ceiling, atomic daily-limit rollback, partial capture, repeated capture prevention, release once, balanced capture ledger.
- The five operational wallets had total available=0 and locked=0 when inspected; isolated tests never referenced their table names.

## Defects corrected

1. Transfer daily-counter expressions used reserved DynamoDB name `total`; escaped with `#total`. This was detected by the real DynamoDB test, not mocked tests.
2. Create-hold now records a signed available debit and locked credit with net zero; reconciliation validates the full debit and separate remainder for partial capture.
3. Partial capture removed the full hold from locked balance but recorded only the captured portion as debit. Ledger now records full locked debit, platform credit, and separate available remainder credit.
4. Release/capture now strongly read the canonical order hold and bind the write to the exact hold ID, preventing a stale index result from modifying a replacement assignment.
5. Both wallet snapshots are version-guarded during capture; release also checks wallet version.
6. Create-hold conflict fallback no longer claims a different driver's hold or an inactive hold as success.

## Practical limits and outstanding work

This is service logic plus real DynamoDB verification, not an authenticated browser/API test with two employee sessions. Invitation/TOTP/UI execution still needs a paired operator/approver walkthrough. No operational funds were seeded or transferred.

Order cancellation/unassignment currently catches wallet-release failures and may continue changing order status. Durable retry and reconciliation with actual order state need completion before declaring the full order lifecycle reliable. Legacy duplicate settlement route is already disabled; capture is the monetary settlement path. No automatic historical corrections were made.

## Deployment

Final fixes deployed to `staging-wizz-wallet-service`; CloudFormation update completed successfully. Unauthenticated requests to transfer listing and hold creation were rejected with HTTP 401. DynamoDB listed no remaining verification tables after cleanup.
