# Benefit grant feedback — 288

Read-only staging verification found campaign f688fc65-9f68-4b57-8756-31722a4a38d4 active with DIRECT grant mode and correct 500-IQD goods terms. The target customer's benefit grant record was absent. This does not establish the cause of the preceding click's server response; recent error-filtered service logs did not identify it.

The previous card lacked local reason validation and sent errors to the distant top-of-page status. The revised grant panel labels count and reason, validates integer uses and a trimmed 5–300-character reason before sending, displays pending state, disables all action buttons while processing, restores their previous permission state, and renders both inline errors and a persistent dismissible viewport notification. Successful grants show an explicit customer-specific confirmation after reloading the list. API calls have a bounded timeout, and uncertain/rejected retries preserve the request ID. No grant, campaign, order, wallet or IAM data is written by the fix or its mocked tests.

Browser tests: test/ui/platform-benefit-grant-288.cjs verifies missing-reason rejection without a request, pending state, actual GRANT payload shape, success, server rejection adjacent to the action, controls re-enabled, and stable request IDs. The 287 form browser regression also passes. Use PLAYWRIGHT_MODULE for the locally installed Playwright module and Chrome channel.

Publication uses the reviewed current hosting artifact (job 162), replaces only platform-benefits-admin.js and its cache version in pages/promotions.html, and verifies live bytes. See benefit-grant-publication-288.json. Human retry is required to establish whether a further server-side problem remains; the agent has not granted the benefit on the user's behalf.
