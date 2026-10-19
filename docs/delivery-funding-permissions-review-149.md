# Delivery funding — live permission review 149

Read-only review of account 699561669180, us-east-1. No IAM, Lambda, configuration, table or financial changes applied.

Captured actual configurations/packages for nine staging functions and inline/managed policy versions for their nine execution roles. Stage was verified even for unprefixed WaveSystem function names. Downloaded package SHA256 values match all nine AWS CodeSha256 values. Only whitelisted activation flags were reported; credentials, raw environment variables and presigned download URLs are not in this document. The funding flags and V2 package markers are absent from the current deployment, as expected.

## Proposed minimal additions

Exact review documents: `delivery-funding-permission-candidates-149.json`. Four existing execution roles, six statements, policy name DeliveryFunding149. Expected hashes of captured role-policy snapshots are included to detect stale review before application. Do not overwrite existing policies.

| Function using the role | Additional access |
| --- | --- |
| WizzUser-CreateOrder-staging | Query staging-MerchantPlatform for BRANCH#*; conditional checks and Put on staging-PlatformStaff DELIVERY_BUDGET#*, DELIVERY_USAGE#*, DELIVERY_RESERVATION#*; conditional checks on DELIVERY_FUNDING#*, EMPLOYEE#*, and OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS |
| staging-driver-financial-accept | GetItem, ConditionCheckItem and PutItem for the three delivery budget/usage/reservation prefixes only |
| staging-merchant-response-99 | Same campaign-record access for guarded rejection/expiry release |
| order-receiver-merchant-orders-staging-v1 | Same campaign-record access for guarded manual merchant rejection |

All resources are the two exact staging table ARNs. LeadingKeys are mandatory; requests without them cannot match the new statements. PutItem is limited to the campaign allowance/usage/reservation prefixes. Transaction version/amount predicates are enforced by application code; IAM does not itself force a PutItem to include those predicates.

No new wallet, ledger, hold, transfer, payout, DeleteItem, Cognito or table/index authority. Existing access is reused instead of granted again. The staff role already has the tested delivery-policy/budget access, so no staff IAM addition is proposed. Each candidate role is currently used by exactly one expected Lambda; trust is Lambda-only and no permissions boundary was returned. Trust policies are not changed.

## IAM simulation evidence

53 actual principal-policy cases:16 allowed and37 implicitly denied before additions. No unresolved contexts or errors in the final baseline. Additional cases initially hit IAM throttling; reran only incomplete cases serially and retained completed results.

Simulated current principal policies plus the proposed documents without saving them to IAM:53/53 allowed, zero unresolved cases. Two local generator tests ensure only denied scoped actions are added and reject missing context, explicit deny, boundaries, foreign resources, unrelated writes or DeleteItem.

This establishes the selected identity-policy cases, not complete service authorization. Resource/endpoint policies, SCPs, scheduling, live packaging and actual transaction/device tests still need coordinated verification. Before any application, recapture and compare current role policies, Lambda code/revisions and role use; stop if they changed.

## Release coordination still required

Prepare/review exact Lambda and frontend overlays before publishing. Preserve existing unrelated code, settings and financial rollout scope. Funding activation remains absent/default OFF, not a new authorization to reopen an expired canary. Hosted financial scheduling remains gated until verified. Keep the merchant deadline worker and manual rejection adapter in the same release so unaccepted funded orders can release their original allowance/cash correctly.

The four IAM additions above are prepared only. They are not covered by earlier approval99 for reception or113 for settlement retention. No publication or permission change was attempted during this review.
