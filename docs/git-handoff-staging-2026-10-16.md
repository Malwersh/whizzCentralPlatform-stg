# Staging source handoff — 2026-10-16

The four repositories share source through `feature/malwersh/bootstrap` and `staging-main`. A Git merge does not provision or activate AWS resources. Financial COD completion, returns and reassignment remain OFF and require coordinated deployment and the checks in section 37 of `finance-pricing-settlements-returns-unified-plan.md`.

## Included work

- CentralPlatform: merchant onboarding/review, staff/device policies, pricing and quote contracts, wallet/report readers, and the unfinished financial lifecycle with tests and release preparation tools.
- Merchants: personal registration, branch drafts/review, staff/device workspaces, products/discounts/reports, and owner return/cancellation screens.
- Drivers: frozen financial offer display, delegation to the financial writer, return screens and pre-pickup unassignment.
- Customer: discount/quote checkout, guarded order creation and compatible public order/menu readers.

Temporary login diagnosis was reverted after the account owner confirmed successful login with the correct authenticator entry. No authentication account changes were made.

## Reproduce the shared runtime

Keep the repositories as siblings named `whizzCentralPlatform-stg`, `whizzMerchants-stg`, `whizzDrivers-stg` and `wizzuser-stg`. Install Node dependencies for each service and Flutter dependencies for each app. From CentralPlatform:

```sh
npm ci --prefix backend/wallet-service
node scripts/sync-merchant-staff-policy-contract.cjs --check
node scripts/sync-merchant-wallet-runtime.cjs --check
node scripts/sync-delivery-pricing-runtime.cjs --check
node scripts/sync-delivery-quote-order-runtime.cjs --check
npm run build --prefix backend/wallet-service
node scripts/build-delivery-quote-runtime.cjs
node scripts/build-delivery-quote-runtime.cjs --check
```

The customer delivery-quotes `runtime.js` bundles SDK dependencies and is intentionally excluded from Git. Generate it with the command above before testing that handler or preparing its deployment. The smaller generated contract/runtime copies used directly by the services are included and checked by the sync scripts. `node_modules`, Python caches, Flutter/native build output and local secrets remain local.

## Deployment limits

- Review deployed package differences and CloudFormation ownership before applying templates. Git source is not proof that the entire template matches the live environment.
- Keep financial feature flags OFF. Do not enable a partial financial lifecycle from this source handoff.
- Synthetic DynamoDB verification did not validate Gateway/Cognito, real dispatch, human devices, shared promotion funding or production operation.
- Compensation, outbox delivery, retention/deletion and reconciliation remain required before financial activation. Employee transfer work must not be deployed merely because it is now shared in Git.
- No AWS or mobile deployment is part of this handoff. CentralPlatform's existing GitHub deployment workflow targets a push to `staging`, not `staging-main`.
