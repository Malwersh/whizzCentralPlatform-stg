# Driver wallet funding — Staging

Implemented manual ZainCash transfer funding with a fixed minimum of 25,000 IQD. Recipient configuration is persistent and versioned; initial recipient is 07800868280 / محمد علي دعاش. Driver creates a PENDING request with amount, transfer reference and private JPEG/PNG receipt. Receipt is limited to 4 MB, signed for five minutes, encrypted at rest, scoped to the authenticated driver and immutable on upload. Backend checks image signatures before accepting the request.

Creation does not credit wallets. Creation retry key, unique normalized transfer reference, receipt reservation, request and audit record are written atomically. Requests retain recipient configuration snapshot. Duplicate references remain reserved, including rejected requests, to prevent reuse; corrections require a separate financial reconciliation workflow.

Only the central Cognito `finance_manager` group can list/review funding or edit recipient configuration. The current administrator was assigned this group; new authentication is required to pick up membership. Enforced by the deployed REQUEST authorizer and wallet handler. Admin pool corrected to `us-east-1_wz7vwZZxz`. Driver and service pools retained. Finance page: `/pages/finance.html`.

Approval reuses the existing wallet double-entry records and atomically changes request status, driver balance, platform cash balance, ledger entries, audit record, approval retry record and daily manager counter (500,000 IQD). Optimistic wallet version guards protect recorded ledger balances during concurrent operations. Creator cannot approve their own request. Conditional conflicts return a refresh/retry response. Rejection does not credit funds.

Direct ZainCash and bank card methods are visible but disabled on client and server. Automatic funding is not integrated: merchant onboarding, provider selection, backend payment sessions, signed provider verification, idempotent successful settlement, inquiry/reconciliation, refunds and UAT are still required before enabling either method. No payment credentials are shipped in the app.

Validation: TypeScript build; eight Node tests covering validation, creation retries/reservations, configuration restrictions, handler permissions and atomic approval guards; two Python tests covering the deployed authorizer's finance/driver route permissions; Flutter analyze; JavaScript syntax; live Staging configuration/list reads and private signed upload plus overwrite rejection. One-pixel test receipt deleted. No real transfer, no credit and no end-to-end real payment approval performed. JWT cryptographic validation is existing Cognito verification, not simulated as an integration test by the role tests.

Operational follow-up: test one real transfer through driver submission, compare against ZainCash account history, then approve from the manager session and verify the resulting balances and ledger. Broader finance reconciliation, long-history pagination, receipt retention and provider integrations remain separate work. Existing holds/capture/release and order settlement were preserved.

## Finance page correction

Finance page now uses the shared Material 3 stylesheet, sidebar/navigation manager, current account footer and active finance navigation item. Arabic content direction is scoped to the page content so it preserves the existing platform shell. Cognito session is read through the existing authentication service before requesting finance data. A stale or missing finance group still requires reauthentication; the server's role requirement is preserved.

Confirmed preflight succeeded but API Gateway-generated 401 responses lacked CORS headers, hiding the real failure behind the browser's `Failed to fetch`. Added CORS to DEFAULT_4XX/DEFAULT_5XX and explicit UNAUTHORIZED, ACCESS_DENIED, AUTHORIZER_FAILURE and AUTHORIZER_CONFIGURATION_ERROR gateway responses. Authorizer now returns a Deny policy for authenticated forbidden routes (403), while invalid tokens remain 401. The page displays separate actionable Arabic messages and retry controls for these cases.

Validation includes three finance-page tests (shell initialization, authorized loading, 401/403 handling and hidden controls), existing authorizer role tests updated for Deny policies, syntax checks and deployed preflight/401 header probes. No logged-in browser session was available to validate the user's complete finance session.
