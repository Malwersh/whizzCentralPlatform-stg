# Staging platform tabs and driver review audit

This is a source/infrastructure audit, not a signed-in browser acceptance test. No guarantee is made that every legacy tab is production-ready.

| Navigation tab | Verified infrastructure / outstanding issue |
| --- | --- |
| Home / Dashboard | Shared session renewal and Staging data reads fixed; unsupported financial/support metrics remain unavailable. |
| Drivers | Staging table and admin access verified. Approval was a direct DynamoDB write with no push trigger; now handled by the driver-review Stream worker. |
| Customers | Staging table and admin read access verified; shared session renewal tested. |
| Wallet funding / Finance | Dedicated wallet API and finance_manager guard, shared session renewal and previous finance tests. |
| Merchants | Admin read access exists for WhizzMerchants_Businesses. Products/categories/actions still call the general API and require separate implementation/acceptance. |
| Orders | WizzOrders exists in this Staging AWS account; admin read access and pagination repaired. |
| Promotions | Legacy frontend calls /promotions; general configured API has only / and /health. This is an incomplete backend integration. Removed token-debug logging and stale Dev constant. |
| Regions | Reads WizzCentral_Regions and WizzCentral_RegionsDerived_staging, present in admin read policy. Writes/API actions require separate acceptance. |
| Legacy financial management | Calls /api/commissions, /api/delivery-fees, /api/financial-settings absent from configured API. Separate from the functioning wallet-funding page. |
| Support | Configured WebSocket integration exists; legacy HTTP calls use fallback /api. Signed-in Amazon Connect/WebSocket and HTTP flows remain unverified. |

## Driver review changes

Enabled NEW_AND_OLD_IMAGES Stream on existing WhizzDrivers_staging using the AWS CLI. The table is external to the Drivers API SAM stack; preserve this setting in any future owner template. No driver data/approval was changed to enable the Stream. Dedicated SAM stack staging-wizz-driver-review-notifications consumes only that Stream; permissions limited to the specific Stream and PutItem on staging-WalletNotifications. Stream event IDs deduplicate durable inbox inserts. Ordinary profile updates do not notify. Approved, rejected and suspended transitions emit driver_review_changed. Existing retrying notification worker delivers to registered driver devices and retains undelivered events. Lambda Stream retention is finite; monitor iterator age/failures during outages.

Driver UI now asks for car/motorcycle; backend validates allowed choices on profile submission. Existing already-approved records without vehicle type were not altered. Pending-review screen rechecks server status on push, first display, app resume and manual check, with no continuous polling. Notification is a trigger to refetch authoritative status, never a client-side approval grant. Phone-only copy removed the obsolete email reminder.

Verification: 19 central Node tests (including approval event deduplication/retry), 9 driver region/approval tests, 6 notification-worker regression tests, Flutter analyze on changed files. Real iPhone build installed. Full real-device approval transition still requires acceptance after an actual administrator review; an already approved account cannot recreate an old Stream transition.

Acceptance update: driver review stack deployed successfully; event-source mapping Enabled. Driver API and notification worker code updates successful. Confirmation notification for the already-approved test driver reached deliveryStatus SENT (one attempt), and the user confirmed receipt on the real iPhone. Three Flutter widget tests passed: approved initial state routes home; manual approval recheck routes home without polling; API error remains in review and permits retry. Flutter analyze reports no issues. Central Amplify cleanup job 21 SUCCEED. Real fresh approval transition remains distinct from this confirmation test.
