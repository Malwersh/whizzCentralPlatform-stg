# Delivery funding release preparation — Part 150

Status: local candidates only. No Lambda, frontend, environment, IAM, balance, or scheduling changes were applied.

Ten Lambda overlays were prepared from captured staging ZIPs, plus an overlay of successful Amplify staging job 105. Every untouched archive entry was verified byte-for-byte. The customer legacy handler/router and deployed merchant require paths remain intact. Candidate archives and the exact hash/revision manifest remain private under `/private/tmp/delivery-release-150`; rebuild and recheck live revisions before publication.

Packaging fixes: recursively include pricing runtime dependencies and the customer authority catalog's lazy write-workflow dependency. All seven runtime bundles load; 22 changed JavaScript entries pass syntax checks; 16 targeted customer-package, funded dispatch and pending-response tests pass.

## Additional notification permission

See `delivery-notification-permission-candidate-150.json`. Existing access permits GOODS policy metadata only. DELIVERY notice processing needs projected GetItem on staging-PlatformStaff with leading key DELIVERY_FUNDING#*, a mandatory explicit attribute allowlist, and no full values/policy/funding/wallet authority. This is a fifth role in addition to the four reviewed in Part 149. The role is shared by 11 listed notification functions, so this limited read applies to all of them. Simulation: current role denied, candidate allowed, excluded financial fields denied. No permission was applied.

Publication requires a coordinated scoped review of exact artifacts, configuration and permission deltas, live code/role drift recheck, and explicit authorization for permanent IAM changes. Hosted financial scheduling remains gated. Device end-to-end verification, original-share refunds and partial returns remain outstanding; this package review does not claim those are complete.
