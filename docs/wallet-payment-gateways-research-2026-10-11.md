# Wallet automatic funding: provider review and implementation design

Reviewed official documentation on 2026-10-11. Scope: Staging only. This is a research/design record; no automatic payment method has been enabled and no provider API call has been tested yet.

## Provider findings

ZainCash v2: public UAT merchant/customer test credentials are documented. Authenticate with OAuth2 client credentials, create a transaction, redirect to the returned payment URL, and inquire about the transaction. Redirect/webhook JWTs use HS256 with the provider API key. Webhooks are production-only and require business-team registration. Production credentials follow contractual onboarding. Do not assume the published client secret is also the callback signing key; confirm the test signing key before testing signed callbacks.

Source: https://docs.zaincash.iq/

Qi: public sandbox merchant credentials, terminal ID and web/mobile test cards are documented. REST supports creation, status, cancellation and refunds. Hosted checkout keeps card entry with the provider. Callback authenticity uses RSA-SHA256 and a provider public key requested from support. The Flutter SDK requires native platform bridges and supplied binaries, rather than a standalone Dart package. Confirm live merchant terms, supported issuers, wallet-funding eligibility, settlement and fees directly with Qi; public test credentials do not establish live approval.

Sources:
- https://developers-gate.qi.iq/docs/api-auth/sandbox-test
- https://developers-gate.qi.iq/docs/api-endpoints/create-payment
- https://developers-gate.qi.iq/docs/webhook-guide/message-verification
- https://developers-gate.qi.iq/docs/mobile-sdk/flutter-implementation

## Proposed implementation

1. Retain manual transfer unchanged. Implement independent ZainCash and Qi provider adapters behind create/inquire/verify operations. Start with hosted checkout; native Qi SDK is an optional later improvement.
2. Persist a payment session before calling the provider: authenticated driver, integer IQD amount (minimum 25,000), provider, test/live environment, unique request reference, provider payment ID, state and expiry. Repeated client requests return the same logical session. An uncertain creation result goes to reconciliation rather than blindly creating another payment.
3. Keep credentials in server-side Secrets Manager with separate test/live configuration and allowlisted provider endpoints. The mobile application receives only session identifiers and checkout URLs; it does not collect card numbers or CVV.
4. Returning from checkout triggers a server-side status check. Never credit from a client success flag. Verify provider authenticity and match payment ID, reference, amount, currency and merchant/environment to the stored session.
5. Extract a shared automatic-settlement operation from existing ledger accounting. A conditional transaction credits once, writes balanced ledger entries, records audit and creates the notification outbox event. Manual approval permissions remain separate: no fabricated finance-manager identity for gateway settlement.
6. Use verified webhooks plus bounded server-side reconciliation for missed callbacks. In ZainCash UAT, inquiry is the actual confirmation path; webhook verification is tested with controlled fixtures and separately validated after production onboarding. No continuous client polling or full-screen reload.
7. Isolate simulated credits from spendable Staging balances: dedicated test ledger/wallet namespace and designated test accounts. A sandbox SUCCESS must never fund normal driver wallets or platform cash balances.
8. Finance managers view attempts, provider references and discrepancies and control enabled methods. They cannot force an unverified automatic payment to SUCCESS. Test/live status is visible and audited.
9. Cover duplicate/replayed callbacks, invalid signatures, mismatched amounts, timeout after creation, cancel/expiry, late success, concurrent settlement, missed webhook and app closure. Refunds use a distinct audited compensating ledger flow; no blind retry of non-idempotent provider refund requests.

## Activation criteria

Sandbox-ready means create, checkout, verification, isolated settlement and notification pass end-to-end tests. Production-ready additionally requires merchant approval for this wallet-funding use case, live credentials/endpoints, callback keys and registration, agreed fees/settlement/limits, and live acceptance testing. Switching credentials alone does not satisfy these criteria. Qi is a proposed card provider, not yet a contracted provider; verify card coverage with test cases and provider confirmation.
