# Driver wallet sandbox implementation — Staging

The existing manual transfer and spendable wallet remain unchanged. Sandbox payments use `staging-SandboxPayments`, a separate composite-key table for settings, sessions, balance, paired test ledger entries, provider-payment uniqueness reservations and configuration audit. Successful test payments never update `staging-Wallets`, `staging-LedgerEntries` or platform cash balances.

Only allowlisted driver subjects can create, view or check sandbox payments. Initial designated account: `34d8e408-1021-7076-6055-7325644f97cb`. Only finance managers can change allowlists/provider switches or inspect an allowlisted driver's test overview from the central finance page. Bootstrap is recorded with the actual AWS setup principal, rather than a fabricated administrator identity. Other drivers receive `eligible: false` and no test controls.

Credentials are server-side Secrets Manager entries `wizz/staging/payments/qi/sandbox` and `wizz/staging/payments/zaincash/sandbox`, containing the public official sandbox credentials. None are bundled in Flutter or the central frontend. Provider hosts are fixed to UAT endpoints; returned checkout links must be HTTPS and match the expected provider host. SAM conditions omit the test table, its IAM permissions and sandbox-secret access outside Staging. The runtime also rejects sandbox operations unless ENVIRONMENT is staging.

## Routes

- GET `/wallet/funding/sandbox/config`: caller's eligibility and enabled test methods.
- GET `/wallet/funding/sandbox`: caller's isolated balance and recent test sessions.
- POST `/wallet/funding/sandbox/payment`: provider, integer IQD amount (25,000–500,000), unique UUID requestId. Driver is taken from authorizer context.
- POST `/wallet/funding/sandbox/notification`: Qi callback hint, rate-limited per payment; authenticated inquiry is the sole settlement authority. Callback amount/status/driver fields are ignored.
- POST `/wallet/funding/sandbox/check`: requestId; server queries provider with its merchant credentials and verifies payment ID, reference, amount, currency and final success before test settlement.
- GET/PUT `/wallet/funding/admin/sandbox`: finance-only versioned settings. GET with driverId returns that allowlisted driver's overview.

The ordinary live `/wallet/funding/payment` method remains disabled.

## Reliability and user experience

A session is reserved before contacting the provider. Retrying the same request returns it, and changing its amount/provider is rejected. Ambiguous creation timeouts remain CREATION_UNCERTAIN; automatic recreation is prohibited and requires investigation. Confirmed success atomically changes session state, reserves the provider payment, increments the isolated test balance, writes equal opposite ledger entries and creates a clearly labeled sandbox notification. Conditional conflicts re-read the session and succeed only if it was already settled.

The existing notification worker delivers `wallet_sandbox_payment_succeeded`; its text explicitly states the spendable balance is unchanged. Payment status is checked on opening/resuming the test screen and manually; no periodic client polling. An EventBridge schedule every five minutes checks up to three due sessions concurrently, with a ten-minute per-session retry interval. Unresolved payments after 24 hours become REVIEW_REQUIRED. Removed allowlist accounts cannot run driver checks; pending operations require manager investigation before removing an account.

The hosted browser payment flow is used for both providers. Return page `/pages/payment-return.html` instructs the user to return to the app; it never claims that returning proves success. Checkout does not yet have an automatic app deep link. Qi's supplied native SDK is not installed.

## Validation and remaining acceptance

Official sandbox creation and inquiry succeeded for both Qi and ZainCash without completing a payment. Live provider responses showed ZainCash transaction IDs and amounts nested in `transactionDetails`; the adapter uses that verified schema. Qi uses `/payment/{paymentId}/status` for inquiry. Unit tests cover access denial, production rejection, duplicate request handling, mismatch rejection, isolated balanced settlement, settled retries, ambiguous creation and concurrent settlement. Existing manual-funding and push tests are retained. Flutter analysis and routing tests are run for the modified app.

A payment completed by a human using official sandbox card/wallet data remains necessary to validate hosted checkout, 3DS/OTP, SUCCESS settlement, resulting push notification and return-to-app behavior. This cannot be called end-to-end validated on creation alone.

Qi callbacks trigger an authenticated server inquiry against a stored provider-to-session lookup. The callback itself is not trusted: its status/amount cannot settle anything. Unknown payment IDs are acknowledged without a provider call; repeated known-payment callbacks are limited to one inquiry per minute. ZainCash UAT does not emit payment webhooks. Provider inquiry remains the confirmation authority for both. Before live activation, replace this with a proper verified webhook endpoint (Qi provider public key, ZainCash callback API signing key), validate it with provider fixtures and register the production URL. Also finish uncertain-creation recovery, pagination, request throttling, refund/chargeback compensation and merchant onboarding for the wallet-funding use case. Test credentials must never be promoted to live credentials, and live automated settlement is not enabled by this change.

Sources: https://docs.zaincash.iq/ ; https://developers-gate.qi.iq/docs/api-auth/sandbox-test ; https://developers-gate.qi.iq/docs/api-endpoints/get-payment-status

## Deployment verification

Staging SAM stack updated successfully; Amplify staging job 18 succeeded. Live Lambda checks created PENDING sessions for both providers, denied a driver's finance-setting update (403), returned eligible=false for a non-allowlisted driver, and reported isolated balance zero before payment. Unauthenticated sandbox configuration returns 401. An unknown callback claiming SUCCESS is acknowledged without crediting anything. The primary driver's available balance remained 50,000 IQD and locked balance zero. The user confirmed both test methods appear on the real iPhone. Final completed-payment acceptance is pending user checkout.

Validation totals: 23 Node backend tests (including sandbox, manual funding and push), 3 Python role tests, 3 finance-page tests, Flutter analysis without issues and 2 routing tests including the sandbox notification type.
