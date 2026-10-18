# E-Nay browser edition

Responsive web/mobile PWA for a single barangay clinic, with separate patient and staff accounts, Cloudflare D1 sharing, and encrypted account-specific offline copies. Java console and JavaFX applications remain separate. Real licensed photography only; see [ASSETS.md](ASSETS.md).

## Run locally

Use Node.js 24 or later from the repository root:

```sh
node web/server/dev-server.mjs
```

Open http://127.0.0.1:8765/. This serves both the website and its account API. A static Python server or opening index.html directly cannot provide accounts or sharing. Local clinic state is stored in ignored data/local-web/clinic.sqlite; it is separate from production and Java data. No account is created by default. The database owner must approve staff access.

For automated tests only, start with --test. This uses an in-memory database and fictional test.staff, test.patient and other.patient accounts with the password in tests/session.mjs. These fixtures are never included in the production deployment and must not be used as real credentials.

## Accounts and privacy

Public registration always creates a patient account. Only a trusted database owner can approve a staff account; the public API cannot promote accounts. Staff manage clinical profiles, visits, vaccination dates, growth measurements, vaccine inventory, imports and clinic backups. Staff link verified patients/guardians to existing maternal or child profiles through Patient access. Patients can view only their linked records and general care guides. All private API calls check the current account role on the server. Changing a URL or hiding/showing controls does not grant access.

Passwords are salted scrypt hashes (N=32768, r=8, p=3); plaintext passwords are not stored. API access requires both an HttpOnly Secure SameSite cookie and a separate per-tab proof held only in memory. The device cookie alone grants no access. Sessions expire after 12 hours. Sign-out clears the private screen and in-memory key/proof, and revokes the online session when reachable. Auth attempts are rate-limited. Mutations require the exact same origin.

The first staff account is provisioned by the trusted Cloudflare owner after its holder registers and confirms the username. No default staff password, public role picker, or first-visitor takeover exists. There is currently no self-service password reset, email verification, MFA, or multi-clinic separation; account recovery requires a trusted owner workflow.

## Offline use and synchronization

Sign in online first on each device. Compatible browsers cache the public app shell and short guides. IndexedDB stores only an AES-GCM encrypted authorized snapshot, using a non-extractable key derived from the password with PBKDF2-SHA256 (600,000 iterations). The password and API proof are never persisted. Account metadata and a random salt/nonce are stored outside the ciphertext; the account ID, username and role are authenticated as additional data. A copied or modified role label cannot decrypt another role’s snapshot.

Wait for both Offline ready and confirmation of an encrypted device copy. Unlock the same account with its password when offline. An incorrect online password never falls back to offline unlock. If storage APIs are unavailable, the session can operate online only; failed network saves retain the form. Messenger’s embedded browser may lack offline APIs: open the site in Safari/Chrome and install from there. This is a PWA, not an APK or App Store package.

Staff saves persist the encrypted device copy before acknowledging an offline change. Synchronization uses an operation ID and a server revision comparison. A stale device cannot overwrite newer clinic records: its pending copy remains available for a private backup and explicit review. IndexedDB transactions also compare the local generation to reject stale editing tabs. Sign in online after reopening an offline session to obtain a new memory-only proof. Use Sync / refresh to load accepted cloud changes. Updates are not pushed live to other devices.

Offline authorization reflects the last downloaded role and links. Revoking access stops future server reads/writes immediately, but cannot erase a previously downloaded offline copy. Offline staff edits after revocation remain local drafts that the server rejects. Account holders must protect their device and password. Downloaded JSON/text backups are unencrypted and need private storage. Cloudflare/the trusted database owner can access cloud records; this is not end-to-end encryption of the server database.

Old enay.workspace.v1 localStorage records are preserved and never uploaded automatically. Staff may choose Data & backup > Review records from the previous app, inspect the result, then explicitly confirm import. A confirmed clinic import clears patient account links, requiring staff identity verification and linking again. Stale/rejected imports leave current links intact. Damaged or all-invalid sources cannot silently blank clinic records. Java imports remain profile-only; complete web backups include contacts, barangay and all care types.

## Working clinical features and proposal gaps

Implemented: validated maternal/child profiles; contact and barangay; search/filters; visit notes, symptoms, diet notes, blood pressure/follow-up; staff-entered vaccine dates and status labels; child measurements and a weight chart; manual assessment flags; stock batches/thresholds/expiry alerts; static sourced care guides; reviewed backups and Java text compatibility. Stock is entered separately and is not automatically deducted on a dose entry.

The user approved shared Cloudflare storage as a change from the original single-device proposal. This release implements access and sharing, but it does not finish the remaining clinical proposal modules: built-in approved vaccine schedules, pregnancy/development timelines, automatic growth/nutrition screening, independent daily symptom/food logs, monthly reviews and rule-selected guidance. Manual entries/flags are not represented as those clinical algorithms. JavaFX is also not a Swing rewrite of the proposed Java design. No AI diagnosis or SMS/email system is included.

## Deploy on Cloudflare Pages

Production: https://e-nay-care.pages.dev/ . Direct Upload is independent of GitHub pushes.

1. Create an empty D1 database and bind it as DB in the production Pages project.
2. Use compatibility date 2026-10-18 and nodejs_compat.
3. Run node web/server/build-worker.mjs. This deterministic dependency-free build emits dist/_worker.js from the maintained server/core sources.
4. ZIP the contents of dist/ at the archive root, including _worker.js, and use Pages Direct Upload. Do not upload local databases, test fixtures, passwords or environment files.
5. Verify /api/status returns ready:true and unauthenticated /api/workspace returns 401. The API initializes the empty schema with an atomic D1 batch; no production accounts are seeded.

The service worker caches only the public shell, never private /api responses. Bump its version after frontend changes and keep its module list aligned. The canonical ./ entry avoids Cloudflare’s /index.html redirect-cache ERR_FAILED issue. Existing users can open /start#workspace while connected to update without deleting old records. An old worker may require a second normal reload after installation.

## Checks

From the repository root, with the disposable --test server running for browser suites:

```sh
node --test web/tests/core.test.mjs web/tests/accounts.test.mjs
cd web
npm install
npx playwright install chromium
cd ..
node web/tests/browser.test.mjs
node web/tests/presentation.test.mjs
node web/tests/account-browser.test.mjs
node web/tests/service-worker.test.mjs
```

The suites cover core validation/recovery, API authorization and role revocation, linked-only patient reads, offline encrypted unlock, wrong passwords, sign-out, malformed imports, stale tabs/devices, idempotent saves, mobile layouts, reduced motion and hosting-cache recovery. Browser screenshots go to ignored test-output/web/. BROWSER_BIN, PLAYWRIGHT_MODULE and ENAY_URL may select local testing dependencies/URL. Tests use fictional records only; physical iPhone/Safari has not been tested.
