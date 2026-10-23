# Platform benefits form redesign — 287

This change groups the existing platform-benefit editor into benefit/value, eligibility/stacking, audience/scope, and validity sections, with a live summary and responsive layout. The form explicitly identifies platform-only funding and separates the per-order funding cap from the minimum goods value.

Free delivery hides the fixed discount amount while preserving amountIqd=0. Goods discounts retain the server-required one use per customer. Direct grants expose customer lookup and require a selected customer before draft creation; granting the entitlement after publication remains a separate action. Targeted customers remain subject to the visible audience condition. Reset clears editing, selected customers and scope, then restores valid defaults. Dates and the cap are validated before submission.

Percentage discounts already belong to the protected offers workspace, not the platform-benefit v1 schema. The new percentage choice opens that existing editor with type=percentage and source=platform. It cannot submit a percentage as a fixed-benefit payload. No backend, allocator, immutable order pins, campaign funding approval, agreement policy or wallet behavior changes.

The current hosting baseline is job 161. The release preserves its full artifact and changes only platform-benefits-admin.js plus that script's cache version in pages/promotions.html. It does not replace the page with the older local Git copy or merge unrelated colleague UI. See benefits-ui-publication-287.json for publication status. Future hosting builds must include this script and its page reference; the publication script applies the reference change to the reviewed live page artifact.

Verification: Node syntax check; mocked Playwright browser tests cover fixed 500-IQD payload/branch, free conditional amount, one-use constraint, percentage handoff without a write, direct-grant missing-customer rejection, reset, no page errors, and widths 390/768/1440. No actual campaign or financial data is written by these tests.

Run from repository root with Playwright installed (Chrome channel):

```sh
PLAYWRIGHT_MODULE=/path/to/playwright node test/ui/platform-benefits-form-287.cjs
```

The snapshots land in the system temporary directory. The publication utility requires a guarded captured base under /private/tmp/benefits-ui-287 and the existing private AWS session helper; it is not a generic redeployment command.
