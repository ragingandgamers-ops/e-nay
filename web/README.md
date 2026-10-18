# E-Nay browser edition

An actual responsive website with an installable Progressive Web App (PWA) workspace. Its users are barangay health workers and midwives; mothers and children are beneficiaries. The existing Java console and desktop applications remain separate and unchanged.

## Run locally

From the repository root, with Python 3 installed:

```sh
python -m http.server 8765 --bind 127.0.0.1 --directory web/dist
```

Open `http://127.0.0.1:8765/`. Stop with Ctrl+C. There is no application build or runtime package installation. Use HTTP localhost for local testing, or HTTPS on a deployed site; opening `index.html` directly as a file does not provide service-worker offline support. A phone needs the deployed HTTPS URL; the computer's localhost URL cannot be used on a phone.

## Desktop and mobile

- The introduction has real licensed photographs, a warm editorial layout, and a clear entry to the workspace. See [photography sources](ASSETS.md).
- The same website adapts to a computer, tablet, or phone. Phone navigation exposes all sections through a labelled menu and tables become readable record cards.
- Android Chrome/Edge can install the PWA. iPhone/iPad users use Safari's Share > Add to Home Screen. Installation controls depend on browser support. This is a PWA, not an Android APK or an App Store application.
- Connect once on each device. Wait for **Offline ready** before disconnecting. The service worker verifies the complete cached shell before reporting readiness. It caches all code, local photographs, icons, and the guides.
- Profile creation, editing, search, care records, backup, and restore use local browser storage and do not need a server connection. External source links require internet and show a clear message when the browser is offline.

## Working features

- Maternal and child profiles, case-insensitive ID uniqueness, exact three-digit IDs, preserved name capitalization, real date validation, contact and barangay fields, active/inactive status, search, and filters.
- Checkups with symptoms, food/diet notes, blood-pressure transcription, and follow-up dates.
- Staff-entered vaccination appointments and administered dates; due, overdue, completed, and upcoming labels. Inventory quantities are entered separately; administering a dose does not automatically deduct stock.
- Child weight and length/height records, a dated weight chart with an accessible values table, staff assessment notes, and follow-up flags. Measurement dates must be within the child's first two years; historical data stays accessible.
- Vaccine batch stock, expiry dates, configurable low-stock thresholds, and summary alerts.
- Short cached care guides with linked WHO sources and a home-visit checklist. Guides are general information, not personalized treatment recommendations.
- Complete JSON backup/restore and profile-only UTF-8 Java text import/export. A reviewed text import preserves matching browser-only profile fields and refuses to remove profiles referenced by care records.

## Data and recovery

Data is saved under `enay.workspace.v1` in localStorage, separately for each origin, browser profile, and device. It is **not** automatically synchronized with other devices or the Java `data/` folder. It is not encrypted. Use fictional records for this school build on shared/unsecured devices; a clinical deployment needs an appropriate security and access-control design.

Download a complete backup before clearing site data, changing the site URL/browser, or switching phones. Restoring a complete backup replaces the receiving workspace after explicit review. Empty/invalid text imports cannot blank saved data. Malformed rows are reported, valid rows are staged without null gaps, and replacing data requires a checkbox confirmation. Complete JSON backups are validated as a whole before restoration.

The application validates the full candidate state before a single storage write. Quota and permission errors preserve previous records and keep the form values. Unreadable stored data blocks new writes and blank backup exports; users can download the original bytes and explicitly restore a valid backup. A revision check rejects stale saves from another tab. Web Locks serialize same-origin writes where supported; use a single editing tab on browsers without Web Locks.

## Relation to the proposal

The proposal establishes rural communities, health-worker workflows, offline operation, and single-device storage. This browser edition implements the manual record workflows above alongside the Java project; it is not a rewrite of its Java OOP coursework.

The following proposal goals still need separate clinical specification and implementation: an approved built-in immunization schedule, automated growth-standard/malnutrition screening, trimester/development guidance, and targeted intervention recommendations. The current app intentionally labels staff-entered schedules/assessments accurately and does not present an invented schedule, WHO curve, or diagnostic algorithm as complete. Notifications are on screen only; there is no SMS/email delivery or cloud synchronization.

## Checks

From `web/`, Node 18 or later:

```sh
node --test tests/core.test.mjs
npm install
npx playwright install chromium
npm run test:browser
```

Start the local server on port 8765 before the browser test. `ENAY_URL` can select a different local test URL; tests must use a disposable browser profile with fictional records. `BROWSER_BIN` selects a compatible installed Chromium browser; `PLAYWRIGHT_MODULE` optionally supplies an existing Playwright package directory.

The core suite covers normalization, dates, historical records, duplicates, malformed text rows, capacity, quota/permission failures, corruption recovery, backup validity, clinical links, and stale-tab saves. Browser tests exercise actual forms, reviewed imports, offline reload and record creation, recovery, four viewport widths, and mobile form layout. Screenshots go to ignored `test-output/web/` at repository level when run from the repository root.

## Hosting and offline updates

Static files are in `dist/`; `.openai/hosting.json` retains the associated private Site identity. Do not commit source credentials. Keep `sw.js`'s asset list in sync with the shell. Bump its cache version when changing a release so the next connected visit installs the complete new shell. Do not clear user localStorage on app upgrades. First-time opening, installation on a new device, and updating an old offline copy require connectivity.
