# Coordinated staging delivery-funding release 151

The exact review manifest is `delivery-coordinated-release-151.json`. Scope: ten Lambda ZIP overlays and three changed frontend files above successful Amplify staging job 105, account 699561669180, us-east-1. Candidate artifacts remain private in `/private/tmp/delivery-release-150`. Their hashes and base revisions are recorded in the manifest. No changes have been applied.

## Verification

All ten final archive handler exports load in isolated subprocesses with outbound networking blocked, without invoking a handler. Synthetic non-secret initialization settings are used; this does not prove live service transactions. Earlier 16 targeted tests pass and two permission-generator tests pass. Fresh read-only comparison found no code/revision/handler/role or selected flag drift across ten functions, no policy drift across ten roles, and no newer successful or active frontend deployment. These checks must be repeated immediately before applying changes.

## Requested permanent permissions

Five existing roles, seven additional statements in total: the four scoped funding policies in review 149 plus the projected notification metadata policy in review 150. No new role, table/index, wallet/ledger/hold/transfer/payout authority, DeleteItem or Cognito authority. Three roles gain guarded campaign-record reads/writes; customer gains branch discovery and campaign/authority condition checks; the shared notification role gains projected DELIVERY_FUNDING metadata reads. That notification role is used by eleven functions, as explicitly listed in the manifest. IAM limits keys/fields; transaction predicates remain application enforcement.

These are permanent IAM additions and require scoped authorization. Earlier approvals for reception 99 and settlements 113 do not specify this release's additions.

## Publication sequence and limits

Verify artifact hashes and fresh baseline; add only the named policies without overwriting existing policies; deploy consumers (driver acceptance, integration, merchant worker/manual adapter and dispatch overlays), then customer runtime, staff service and notification helper, then frontend. Each Lambda write must use the expected current revision; verify the resulting CodeSha256 and successful update before continuing. Stop on any mismatch or failed step. Keep a record of each applied step and returned revision.

This package-only phase preserves all environment settings, rollout limits, scheduler gates and balances. It does not enable V2 order admission or reopen an expired test scope. Admission must wait for coordinated hosted financial dispatch verification and device tests. Merchant and driver application builds are a separate device step. Original-share refunds and partial returns remain unfinished.

Rollback uses the captured original Lambda ZIPs and original frontend job 105 artifact. Check current revisions before rollback; do not overwrite unrelated later work. Remove only newly installed named policies after checking no active funded orders depend on them. Do not rewrite transaction history or financial balances.


## Publication result

The user explicitly approved the five scoped permission additions and this exact package/frontend release. Applied all five named inline policies and verified exact documents; published all ten Lambda overlays with expected revision checks and verified CodeSha256, handler, role, and unchanged environment after each update. Amplify staging job 106 succeeded; all three changed served frontend files match candidate bytes. The final independent read-only verification passed for ten functions and five policies. Evidence: `delivery-publication-receipt-151.json`. No environment, admission, scheduler, rollout scope or financial data writes were made by publication. This is a deployed package milestone, not an end-to-end funded-order activation claim.
