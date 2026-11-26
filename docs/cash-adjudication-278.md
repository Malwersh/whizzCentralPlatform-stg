# 278 — administrative resolution of missing or disputed cash declarations

Implemented and published to staging. Human acceptance of this new path is pending. Scope: active FULL_CASH_AT_DELIVERY_V1 orders whose original financial outcome has not been posted. A posted outcome cannot be overwritten through adjudication. Historical return and top-up tests were read-only verified unchanged.

Staff can open a review even when neither original party submits a declaration, document a contact attempt with each party (channel/result/note, server timestamp and actual staff identity), and approve an independently evidenced collection finding. Supported bases: missing declaration, differing latest declarations, or an independently matched shortfall. Food delivery must be explicitly confirmed against independent evidence. No customer/driver report or matched-pair verification is manufactured.

Approval and execution are separate actions. Approval requires current finance authority and limit covering the full order amount. Execution requires current execution and finance permissions, current saved approver guards, the unchanged accepted terms, unchanged declarations/contacts, and all existing assignment, wallet, budget, lifecycle and order fences. Changed evidence or revoked authority blocks execution. Cancelling an unexecuted approval never posts money. Replayed lost responses do not duplicate financial or audit records.

Execution atomically records the case decision/event, actual collected amount and administrative evidence source, original settlement and a separate balanced correction journal, wallet/ledger effects, merchant payable/accrual index, dispatch completion and integration outbox. Original accepted pricing is preserved. The original declarations remain immutable history. A suspended/banned driver's liability can be resolved administratively without reactivating the account or offers.

Financial outcomes:
- Full collection proved independently: no shortfall correction.
- Company coverage: explicit shortfall expense and driver wallet credit, no fictitious cashbox movement.
- Customer receivable: explicit receivable and driver credit; operational delivery completes, but the debt and case remain open as AWAITING_CUSTOMER_PAYMENT. Debt is not represented as payment or written off. Collection/write-off requires a separately documented subsequent process; it is not performed by this action.
- Evidenced driver responsibility: borne through the existing net settlement; no second driver debit or duplicated receivable.
- Merchant adjustment: explicit merchant-payable reduction and corresponding driver credit, capped at original merchant payable.

New merchant accrual schema 6 preserves quote economics and separately exposes administrative adjustment and actual collected cash. Merchant statement and batch readers validate the immutable correction journal; batch freeze also fences it transactionally. Legacy accrual schemas and historical statements retain their original shape/digests. Wallet statements recognize the new explicit ledger category with validated decision metadata under LEDGER_EFFECTS_V7.

Closed-case retention preserves financial amounts, finding/proof digests and execution references while stripping free-text contact/evidence notes and raw personnel identities from deletion archives. Open receivables/cases block deletion. Source financial journals remain linked and auditable.

Verified automated checks: 1394 canonical financial tests; 244 staff tests; 268 retention tests; 27 initial cash-runtime bundle tests; 49 actual merchant-reader/batch bundle tests; 30 actual wallet-ledger module tests; two isolated real-browser flows (legacy report/retry/privacy/mobile and missing-declaration opening/contact/approval/execution/mobile). TypeScript compiles cleanly. Read-only live-data preflight proved previous payable5450 and paid return compensation6250 through the exact new merchant-proof helper. IAM simulation allows the projected fields without permission changes.

Deployment: see cash-adjudication-publication-278.json (initial financial/staff/retention overlays), cash-adjudication-read-publication-278.json (final staff proof readers and wallet/lifecycle classifier overlays), cash-adjudication-ui-publication-278.json (hosting157), and cash-adjudication-verification-278.json (effective final function hashes and historical states). Only explicit ZIP entries and admin-page files were changed; other deployed contents, IAM and service configuration were preserved. Customer/merchant native designs and GitHub changes were not merged. No new order, declaration, contact record, decision, refund, payment or cash attestation was submitted by the agent.

Human acceptance next: create a fresh staging test order, then test customer-full/driver-shortfall declarations or a missing party declaration. Administrative contact records, evidence and execution notes must explicitly say staging simulation/no physical cash exchanged. Do not reopen or repurpose the two completed historical tests. Restaurant-employee human testing remains deferred by the user.
