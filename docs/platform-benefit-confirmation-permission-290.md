# Benefit campaign commit fence — 290

The first human confirmation of a 500-IQD goods benefit failed atomically with AccessDeniedException at 2026-10-22T19:27:57Z (Lambda request 3145c38a-dce0-4307-8e5f-06757b923bfa). Preview and pricing succeeded: agreed delivery 1500, goods benefit 500, service 500, total 8500. The runtime pins the current campaign through a ConditionCheck in the order transaction; the creation role could GetItem from the platform campaign table but could not ConditionCheckItem. Previous release simulations covered funding and entitlement tables but omitted this campaign fence.

Read-only checks found no new customer order and both test benefits with reservedUses=0 and usedUses=0. Neither was consumed. The app correctly retained the uncertain attempt rather than automatically issuing a new order.

Added only dynamodb:ConditionCheckItem on WizzCentral_Platform_Discounts to the existing PlatformBenefitEntitlements20261020 inline policy of the staging CreateOrder role. No Lambda code, environment, hosting, grant, order or financial row was changed. Before/after policy simulation proves the added read-only fence and no new Put/Update/Delete permissions on campaigns or permissions on another table. The live role simulation is allowed. The shared benefit IAM source template now includes the same fence for coordinated future provisioning.

Rollback/release inputs are retained in /private/tmp/benefit-confirmation-290. The guarded publication script refuses to overwrite a changed base policy. The old quote has expired without consumption; human resume must reconcile the saved attempt and then renew/review as needed. Do not clear secure storage or create a replacement order automatically. Successful human commit remains pending.
