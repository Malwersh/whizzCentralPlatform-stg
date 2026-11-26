# Staging storefront delivery preview 169

## Result
An authenticated customer can request an informational preview using their own saved address and server-priced product selectors. It reuses the existing road pricing context, branch preparation setting, active delivery policy selection, live authority, campaign budget and customer usage. Free/fixed/calculated fees are separate from courier compensation. No driver location is used for customer fees.

The preview does not reserve campaign funds, consume offers, create orders, increase order counts or mutate wallets. The existing quote and commercial confirmation writer remain authoritative. A separate bounded preview rate counter uses the already allowed CUSTOMER# partition in staging-DeliveryQuotes; the commercial quote quota remains unchanged.

Client cache keys include account, saved address identity and coordinates, store and basket. Old asynchronous results cannot replace a new address. Home warms four stores, requests are limited to two concurrent calls, and a rate-limited/failed request is throttled. Store, cart and checkout use the shared preview; the final commercial total still requires confirmation. Missing route/price/preparation information is not replaced with invented numbers.

## Permanent IAM addition needing explicit authorization
Add only `StorefrontPreviewRead169` from `storefront-preview-permissions-169.json` to existing role `staging-delivery-quotes-DeliveryQuoteRole-ZBt492FUdXTr`, used by `WizzUser-DeliveryQuotes-staging`.

This adds GetItem for products/categories, the USER# order count, and DELIVERY_FUNDING#/DELIVERY_BUDGET#/DELIVERY_USAGE#/EMPLOYEE# evidence; and Query of BRANCH# delivery indexes. Existing organization/account/address/region permissions are reused. No write permission, wallet, ledger, hold, payout, new role, table or schedule is added.

## Publication scope
Patch only the POST handler to recognize action storefront_preview, and add one bundled storefront-runtime.js. All existing quote creation/get code, quote TTL, finance rollout flags, Lambda role/configuration and unrelated ZIP entries stay unchanged. Restore the original ZIP by revision-aware update if verification fails. Do not install the new customer app before the endpoint is available.

## Checks
Targeted backend pricing/quote/policy tests: 45 passed. Targeted enabled customer tests: 18 passed, one existing disabled-path test skipped. Merchant reception settings tests: 3 passed. Customer and merchant signed/simulator builds are checked separately before installation.

## Limits to verify
Guest/GPS-only pricing is not authorized by the existing saved-address pricing contract; request an owned saved address instead of submitting arbitrary coordinates. Conditional goods-discount eligibility is conservative until the existing commercial review prices the discount; preview never authorizes a subsidy. Actual funded order completion and background Live Activity remain separate device tests.
