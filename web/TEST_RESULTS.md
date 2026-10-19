# Family records and connected vaccination release — 19 October 2026

Validation used disposable fictional accounts and data on the local Node 24 server. No real patient records were used.

- 41 core/API tests passed, including server-enforced ownership, stock/role restrictions, auto-linked patient profiles, globally unique IDs, record conflicts, atomic last-dose concurrency, batch expiry, receipt retries, correction refunds, and Philippine midnight.
- 66 general browser assertions passed.
- 16 presentation assertions passed.
- 17 account browser assertions passed.
- 39 family workflow assertions passed: patient edits visible to staff, combined profile histories, compact profile menu, two offline children with linked growth, lost-response retry, clinic dose assignment and stock counts.
- 26 session browser assertions passed.
- 49 localization browser assertions passed.
- Cloudflare redirect/cache regression passed, including legacy recovery without deleting stored data.

Responsive layouts were checked at 320, 390, 768 and 1440 px. Browser automation used Chromium; physical iOS/Safari behavior still needs device testing. Screenshots are in ignored test-output/web/. CI runs these suites with fictional fixtures.

Previous release verification follows.

# Browser edition verification — accounts release

Verified 18 October 2026 on Windows, Node.js 24.19.0 and Chromium 151 via Playwright. Tests used fictional data in a disposable in-memory local clinic and separate browser contexts. No real medical records were uploaded or used in tests.

- 23 core validation/recovery tests passed, including exact IDs, preserved capitalization, real dates, malformed rows, all-invalid imports, capacity, historical edits, quota/permission errors and explicit legacy corruption recovery.
- 10 API tests passed: guests blocked; patient-only registration; linked-only reads; patient mutations forbidden; server role revocation; atomic revision conflict/idempotent retry; invalid link replacement preserves access; reviewed imports clear links while stale imports preserve them; proof-required sessions/logout; same-origin enforcement, expiry and missing-DB failures.
- 66 functional browser assertions passed: real forms/field retries, case-only duplicates, records across all six types, reviewed malformed imports, retained contact fields, offline reload/save/unlock, stale-tab protection, preserved unreadable legacy data, keyboard navigation and nine staff sections at 320/390/768/1440 CSS pixels.
- 16 presentation assertions passed: real photos, scroll reveals, photo drift, workspace entrance, initial/changed reduced motion, embedded-browser guidance and online entry without a service-worker API.
- 17 account browser assertions passed: sign-in gate, staff sync, clinic linking UI, patient-only view, forged inventory route blocked, cookie-only access rejected, no plaintext patient snapshot or login proof in persistent storage, sign-out clears records, offline unlock/wrong-password handling, online rejection cannot fall back to cached access, and separate devices preserve pending changes on a cloud conflict.
- Cloudflare redirect/cache regression passed: repeated visits, /index.html canonical redirect, offline entry aliases, /start recovery from the old ERR_FAILED worker and preserved legacy data.

Public smoke check on the deployed accounts release: /api/status returned 200 with ready:true; anonymous /api/workspace and /api/inventory returned 401; unknown-user login performed its password check and returned 401. This was a health check, not a production medical-data test. A real user-created account was approved as the first staff account only after the user explicitly confirmed its username. No production test/default accounts were seeded.

Commands from the repository root:

```sh
node --test web/tests/core.test.mjs web/tests/accounts.test.mjs
node web/server/dev-server.mjs --test
# In a separate terminal with Playwright installed:
node web/tests/browser.test.mjs
node web/tests/presentation.test.mjs
node web/tests/account-browser.test.mjs
node web/tests/service-worker.test.mjs
```

Screenshots are saved under ignored test-output/web/. Phone testing uses Chromium viewport/touch emulation, not physical iOS/Safari. Current Java sources were unchanged; their earlier verification remains in the repository-level TEST_RESULTS.txt. This is not a security audit or clinical validation, and passing implemented-feature tests does not establish proposal completeness. Remaining clinical proposal modules and offline revocation limits are listed in web/README.md.

## Hygieia design revision — 19 October 2026

The 66 functional, 16 presentation and 17 account browser assertions and hosting-cache recovery regression were rerun successfully after the new design was applied. Desktop, sign-in, staff workspace and compact mobile record-card screenshots were reviewed. Computed font loading confirmed the locally hosted Plus Jakarta Sans face; primary buttons compute to #DA1B2E and the ten supplied palette stops match. Text contrast checks: primary button 5.03:1, active navigation 7.09:1, body 16.18:1, secondary text 5.95:1, success 6.43:1 and warning 6.04:1. These checks do not constitute a complete accessibility audit.
