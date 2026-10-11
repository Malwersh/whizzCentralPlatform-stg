# Staging financial foundation

## Implemented in this increment
- Financial manager only paginated wallet inventory in finance.html; values come from primary operational wallets, never sandbox balances. No incomplete-page totals are labelled as global totals or revenue.
- Handler authorization for arbitrary wallet reads, platform wallet operations and settlement lookup, in addition to API authorizer.
- Legacy POST /wallet/settlement/settle returns 409 before any database access. Capture already debits locked driver funds and credits the platform atomically. Existing completed-delivery caller in whizzDrivers-stg/backend/lambda_driver_api_v2.js uses captureWalletHold; example service-client.ts incorrectly demonstrates both operations sequentially and must not be used.
- Capture validates positive safe integer amount and uses nullish default: zero/negative/fractional/unsafe values cannot credit negative platform amounts or inflate available funds.

## Remaining scope (not claimed complete)
- Verify live deployed caller versions and reconcile historical records read-only for duplicate charges, missing capture and stranded holds.
- Remove obsolete SettlementService financial write implementation and migrate its read model to canonical HOLD/CAPTURE records. Handler is disabled now, but old class is not a safe library for new callers.
- Current wallet schema supports DRIVER and PLATFORM, not customer wallets. Customer authentication, ownership and wallet provisioning must be designed before P2P transfers.
- Add immutable transfer operation record, conditional debit/credit, balanced ledger, idempotency, durable notifications, limits and financial audit in the same transaction.
- Platform transfers use maker/checker separate identities, server enforced approval, reauthentication and original-operation-linked reversals.
- Add canonical operation explorer, reconciliation, accurate reporting, refunds and alerts; legacy financial-management page remains outside this increment.
- Harden internal service roles and creation-trigger shared secret; ensure each capture is authorized by server-side completed order/driver identity, not arbitrary trusted service payload.
- Test concurrent holds/capture/release, repeated capture/release, wallet suspension, provider reconciliation and invariant preservation before general transfers.

## Validation
TypeScript build, wallet regression tests and new financial boundaries tests; central frontend existing tests. No balances are modified by this implementation or tests. Authenticated UI acceptance and real delivery acceptance remain required.

## Owner and ledger increment
- Finance uses existing authorized AWSUtils driver read to display actual name/phone; no synthetic identity or new broad IAM permissions. Platform is labelled explicitly, statuses/types are Arabic; technical wallet ID remains in hover title.
- Finance-only GET /wallet/funding/admin/transactions reads 50 ledger rows per page. Cursor must belong to the selected wallet; cross-wallet continuation is rejected. Stale responses cannot replace the newly selected wallet ledger.
- Raw accounting ledger is explicitly labelled: hold debit/credit sides are not independent expenses or revenue. This increment does not consolidate accounting entries into business events.
- Staging backend update succeeded and Amplify job 25 succeeded. Authenticated browser acceptance remains for owner name/phone and ledger navigation.

## Read-only audit findings
- Five operational wallets; eight hold records: ACTIVE 1, CAPTURED 3, RELEASED 4. All locked balances equal active hold sums; no negative wallet balances.
- ACTIVE hold for order 6dc03659-fb8f-48f0-bdd3-439bfcb765e7 is 6000 IQD. Exact ORDER#id/META lookup returns no order. DriversApi-staging configuration proves ORDERS_TABLE=WizzOrders in staging account 699561669180; no customer/address fields were read. Missing order is not sufficient authorization to release the hold automatically.
- Platform available balance confirmed 81000 IQD; net ledger entries total 68000 IQD, a 13000 IQD unexplained difference. CAPTURED hold amounts total 18000 IQD. An opening balance or missing historical entries might explain the difference; neither is established. No corrections were applied.
- Zero PLATFORM_FEE category rows were found; that narrow check does not prove absence of historical double charges under other categories.
- Financial reconciliation requires a documented opening balance and original-event evidence before corrections. Transfers remain unimplemented pending this work.
