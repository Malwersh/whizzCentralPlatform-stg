# Cash review choices — part 279

The native macOS RTL select popup could place long Arabic option labels beyond the screen edge. Basis, financial outcome, and shortfall route now use inline radio groups with wrapping labels, no initial selection, and native required validation. The API payloads and financial approval/execution rules are unchanged.

Validation: `scripts/test-cash-adjudication-browser-278.cjs` checks all three groups at 390 px and 1440 px, absence of horizontal overflow, and the mocked approval/execution flow. No customer or driver statement or financial mutation was submitted to staging by this verification.

The bounded hosting publisher replaces only `customer-cash-review.js` and `pages/customer-cash-review.html` in the latest successful staging artifact, preserves all other entries, and verifies deployed bytes. See `cash-choices-publication-279.json` for deployment evidence.
