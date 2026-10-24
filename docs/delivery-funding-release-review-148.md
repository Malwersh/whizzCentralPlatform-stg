# Delivery funding coordinated release review — 148

Status: local review only. Not deployed, not an IAM approval, and no live settings changed.

The local customer, driver, pinned dispatch, integration, merchant rejection/expiry and reporting code now understand the delivery-funded contract. Physical end-to-end verification is still required. Preserve current defaults and hosted-financial restrictions until exact live packages, role policies and host scheduling are compared.

## Newly repaired pre-acceptance lifecycle

Merchant rejection or acceptance-deadline expiry releases original campaign allowance, reserved customer use and platform GOODS + DELIVERY cash in the same existing order/event/journal transaction. No driver assignment is fabricated; no driver/merchant wallet is touched. An explicit internal unaccepted-funding argument reuses the existing release planner and requires an unassigned original V2 snapshot with zero collateral. Automatic acceptance retains funding for dispatch. Concurrent manual acceptance prevents release.

Worker and merchant manual rejection adapter use FINANCIAL_DELIVERY_FUNDING_MODE, default OFF. The worker bundle and merchant_pending_response adapter are prepared together by scripts/prepare-delivery-funding-review-148.cjs. The merchant handler source must be overlaid with the new adapter together; deploying only a caller or flag is insufficient.

## Permission review findings

The source `PublishedPricingPolicy` statement in cod-lifecycle.staging.json permits only DELIVERY_PRICING and DELIVERY_OPERATIONS settings. It does not permit reading/conditionally updating delivery campaign allowance, usage and reservation records. Existing reception approval 99 did not include this new campaign-record authority. Its approval cannot be reused as approval for new IAM changes.

The generated review.json describes required host/table/key-prefix access, not deployable policies. Compare real role policies and CloudFormation ownership before generating minimal deltas. It requests no new driver/merchant wallet authority for merchant response: only existing platform promotion cash release plus campaign allowance/usage records. Hold sort-key descriptions are runtime validations, not IAM sort-key restrictions. No DeleteItem, payout/transfer, Cognito or new table/index changes are proposed.

## Gates and evidence

All defaults remain closed: DELIVERY_PROMOTION_MODE=OFF, FINANCIAL_DELIVERY_FUNDING_MODE=OFF, DELIVERY_FUNDING_MANAGEMENT_ENABLED=false. Source templates now expose explicit default-OFF capabilities for financial integration/writer and staff management. These template edits have not been applied.

Local Chrome mocks verify both new submit/retry and editing an active policy: draft/base/publication versions remain distinct, conflict does not activate changes or auto-resend, changing branch hides the previous form, and read-only staff have no edit controls. This is not proof of live authorization or notification delivery.

Still required: live role/package/configuration comparison, minimal IAM simulation/review, verified financial host/scheduler entry point, coordinated staging deployment and actual device workflow. Original-share refunds/partial returns and the existing legacy coupon timestamp repair remain separate unfinished work. No payout authorization follows from these tests or frozen settlement previews.
