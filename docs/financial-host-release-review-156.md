# Financial host and notification release 156

Status: exact local candidates, not deployed. Review manifest: financial-host-coordinated-release-156.json. Account 699561669180, us-east-1, staging only.

## Current deployment evidence

Captured six actual Lambda ZIPs and verified each package against AWS CodeSha256, plus six roles' policies/trust/usage. Exported the DEPLOYED Drivers REST API stage: 6ogrj6so22/staging uses /{proxy+} ANY AWS_PROXY into DriversApi-staging. The new authenticated hydration path uses that existing proxy; no new API Gateway route, deployment or authorization change is proposed. The existing scheduled timeout rule is enabled, rate(1 minute), with the expected timeout Lambda as its single target. No new rule/table/queue is needed.

## Minimal permanent permissions

Exact policies: financial-host-permission-candidates-156.json. Two existing roles, four statements:

- Creator role: ConditionCheckItem on WhizzMerchants_Businesses; GetItem + ConditionCheckItem on staging-PlatformStaff for OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS only; ConditionCheckItem on staging-AccountDeletion for BUSINESS_LIFECYCLE#MERCHANT#* and ACCOUNT_LIFECYCLE#MERCHANT#*. Existing source reads/order/job writes and Lambda invocation access are reused.
- Shared notification role: lambda:InvokeFunction on the exact staging-driver-financial-accept ARN. This role serves eleven listed notification functions; this invocation capability applies to all of them. No new DynamoDB financial-table reading is granted to it.

The notification service delegates persisted proof checks to a separate default-closed, read-only action in the existing financial service. That action returns only the verified reference, never prices/items/wallets. IAM InvokeFunction cannot restrict a payload action: existing financial mutation actions continue to require original authenticated credentials and their own gates. The new validator strictly accepts action/body only, validates the original saved acknowledgement/scope/lifecycle and returns reference metadata. Default mode is closed.

Simulated all six required currently denied action/resource/key cases with the exact policies: baseline implicitDeny, candidate allowed, no unresolved candidate context. The preliminary 72-case audit intentionally probes unused Creator operations and negative controls; do not turn its whole denied set into permissions. No wallet, hold, ledger, transfer, payout, DeleteItem, Cognito or secret access is added. This is identity-policy evidence, not full service/device proof.

## Exact code scope

Six overlays: WaveSystem_CreateDispatchJob; WaveSystem_StartWave; WaveSystem_HandleWaveTimeout; staging-driver-financial-accept; DriversApi-staging; wizzcentral-notifications-staging-pushSendWaveOffer. Final manifest pins hashes/revisions/environment digests. StartWave's local source differs substantially from live code, so its index gets one surgical financial-branch insertion into the deployed source. Unrelated archive entries are byte-identical. Driver API/client and timeout diffs are explicitly bounded. Notification runtime is bundled with its dependency closure; existing Legacy push helper remains untouched in the captured ZIP.

TypeScript compiles; 43 targeted tests pass, including proof delegation, strict reference echo, notification DB isolation, mode gates and Legacy coexistence. Three bundles load. All six final ZIP handler exports load with networking blocked and synthetic initialization settings, without invoking a handler. Driver hydration's four Flutter tests passed in Part155; reviewed source hashes are in financial-driver-source-validation-156.json. No updated app has been installed in this phase.

## Publication and activation boundary

Requested publication applies ONLY the two named inline policies and six pinned code overlays. Recheck live code/revisions/environment digests, policy snapshots and role use first; do not overwrite an existing same-name policy. Deploy the private validator and notification receiver before the hosted consumers, verify every returned revision/hash and unchanged environment. Preserve captured ZIPs for conditional rollback.

No frontend/API Gateway/environment/scheduler/cohort/balance changes are in this publication request. The modes remain at their captured values. Activation still requires complete scoped configuration across Creator/Start/Timeout/validator/receiver, a new nonexpired explicit order cohort, driver build/device verification, and coordinated order admission. This release does not claim that physical E2E is complete. Original-share refunds/partial returns remain separate unfinished work.

Any code rollback must use captured originals with current-revision checks; stop on unrelated drift. Remove only these newly added policy names after checking no active workflow depends on them. Never alter balance/history to simulate rollback.


## Approved publication result

User explicitly approved this exact two-role/six-package release, then renewed the expired SSO session. Fresh preflight passed: six function code/revision/environment baselines, six role policy/trust snapshots, exact permission-role usage, deployed API stage and existing schedule were unchanged. Installed only FinancialCycleCreator156 and FinancialPushValidation156, then published the six pinned ZIPs in dependency order with conditional revisions. Verified exact code hashes, roles, handlers and unchanged environment/runtime settings after each update.

Independent read-only verification passed for all six functions, both exact new policies, preservation of existing inline/managed policies on all six roles, API deployment ID and scheduled rule/target. Evidence: financial-host-publication-receipt-156.json. No API/scheduler/environment changes, device installation, handler invocation or financial data writes were made by this publication. Next: driver build/device installation and coordinated nonexpired scoped configuration before actual E2E admission.
